const STORAGE_KEY = "card-point-calculator-state-v1";
const FAB_POS_KEY = "card-point-calculator-fab-pos-v1";

const DEFAULT_STATE = {
  score: 0,
  baseAmount: 10,
  sessionNumber: 1,
  sessionStartedAt: new Date().toISOString(),
  sessionPendingStart: false,
  sessionEarned: 0,
  sessionLost: 0,
  history: []
};

const state = loadState();

const scoreEl = document.getElementById("score");
const plus1xBtn = document.getElementById("plus-1x");
const minus1xBtn = document.getElementById("minus-1x");
const rightMultipliersEl = document.getElementById("right-multipliers");
const historySectionEl = document.querySelector(".history");
const historyListEl = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history");
const toggleHistoryBtn = document.getElementById("toggle-history");
const doneSessionBtn = document.getElementById("done-session");
const baseAmountInput = document.getElementById("base-amount");
const quickCalcToggleBtn = document.getElementById("quick-calc-toggle");
const quickCalcDrawerEl = document.getElementById("quick-calc-drawer");
const quickCalcPanelEl = quickCalcDrawerEl.querySelector(".quick-calc-panel");
const quickCalcCloseBtn = document.getElementById("quick-calc-close");
const niuRankButtonsEl = document.getElementById("niu-rank-buttons");
const niuStatusEl = document.getElementById("niu-status");
const niuUndoCardBtn = document.getElementById("niu-undo-card");
const niuClearCardsBtn = document.getElementById("niu-clear-cards");
const niuSelectedCardsEl = document.getElementById("niu-selected-cards");
let wakeLockSentinel = null;
let lastRenderedScore = state.score;
let lastTopHistoryId = state.history[0]?.id ?? null;
const expandedSessions = new Set([state.sessionNumber]);
let niuSelectedCards = [];
let fabPointerId = null;
let fabStartX = 0;
let fabStartY = 0;
let fabPointerStartX = 0;
let fabPointerStartY = 0;
let fabDidDrag = false;
let suppressFabClick = false;
let drawerDragStartY = null;
let drawerDragOffsetY = 0;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };

    const parsed = JSON.parse(raw);
    return {
      score: toInteger(parsed.score, DEFAULT_STATE.score),
      baseAmount: clamp(toInteger(parsed.baseAmount, DEFAULT_STATE.baseAmount), 1, 999999),
      sessionNumber: clamp(toInteger(parsed.sessionNumber, DEFAULT_STATE.sessionNumber), 1, 999999),
      sessionStartedAt:
        typeof parsed.sessionStartedAt === "string"
          ? parsed.sessionStartedAt
          : DEFAULT_STATE.sessionStartedAt,
      sessionPendingStart: Boolean(parsed.sessionPendingStart),
      sessionEarned: Math.max(0, toInteger(parsed.sessionEarned, DEFAULT_STATE.sessionEarned)),
      sessionLost: Math.max(0, toInteger(parsed.sessionLost, DEFAULT_STATE.sessionLost)),
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
}

function formatSigned(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
}

function formatTimeOnly(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSessionLabel(startedAt) {
  if (!startedAt) return "";
  return `${formatDate(startedAt)} ${formatTimeOnly(startedAt)}`;
}

function getSessionGroups() {
  const summariesBySession = new Map();
  const changesBySession = new Map();
  const sessionIds = new Set();
  if (!state.sessionPendingStart) sessionIds.add(state.sessionNumber);

  for (const item of state.history) {
    const sessionId = clamp(toInteger(item.session, state.sessionNumber), 1, 999999);
    sessionIds.add(sessionId);

    if (item.type === "session") {
      if (!summariesBySession.has(sessionId)) summariesBySession.set(sessionId, item);
      continue;
    }

    if (!changesBySession.has(sessionId)) changesBySession.set(sessionId, []);
    changesBySession.get(sessionId).push(item);
  }

  return Array.from(sessionIds)
    .sort((a, b) => b - a)
    .map((sessionId) => {
      const summary = summariesBySession.get(sessionId) ?? null;
      const changes = changesBySession.get(sessionId) ?? [];
      const isCurrent = sessionId === state.sessionNumber;
      const earned = summary ? summary.earned : isCurrent ? state.sessionEarned : 0;
      const lost = summary ? summary.lost : isCurrent ? state.sessionLost : 0;
      const net = summary ? summary.net : earned - lost;
      const earliestChangeAt = changes.length ? changes[changes.length - 1].at : null;
      const latestChangeAt = changes.length ? changes[0].at : null;
      const startedAt = summary?.startedAt ?? (isCurrent ? state.sessionStartedAt : earliestChangeAt);
      const endedAt = summary?.endedAt ?? summary?.at ?? (!isCurrent ? latestChangeAt : null);
      return {
        id: sessionId,
        isCurrent,
        isDone: Boolean(summary),
        earned,
        lost,
        net,
        startedAt,
        endedAt,
        changes
      };
    });
}

function applyChange(multiplier, sign, source) {
  if (state.sessionPendingStart) {
    state.sessionNumber += 1;
    state.sessionStartedAt = new Date().toISOString();
    state.sessionPendingStart = false;
    expandedSessions.add(state.sessionNumber);
  }

  const delta = state.baseAmount * multiplier * sign;
  state.score += delta;
  if (delta > 0) state.sessionEarned += delta;
  if (delta < 0) state.sessionLost += Math.abs(delta);

  state.history.unshift({
    id: crypto.randomUUID(),
    type: "change",
    session: state.sessionNumber,
    delta,
    result: state.score,
    baseAmount: state.baseAmount,
    multiplier,
    source,
    at: new Date().toISOString()
  });

  saveState();
  render();
}

function renderHistory(animateId = null) {
  if (!state.history.length) {
    historyListEl.innerHTML = '<li class="history-item history-empty"><span>No history yet</span></li>';
    return;
  }

  const groups = getSessionGroups();
  historyListEl.innerHTML = groups
    .map((group) => {
      const isExpanded = expandedSessions.has(group.id);
      const netClass = group.net >= 0 ? "plus" : "minus";
      const statusText = group.isDone ? "done" : group.isCurrent ? "current" : "";
      const sessionLabel = formatSessionLabel(group.startedAt, group.endedAt);

      const changeRows = group.changes
        .map((item) => {
          const deltaClass = item.delta >= 0 ? "plus" : "minus";
          const enterClass = animateId && animateId === item.id ? "history-enter" : "";
          return `
            <li class="history-item ${enterClass}">
              <div class="history-main">
                <span class="delta ${deltaClass}">${formatSigned(item.delta)}</span>
                <span class="history-multiplier">${item.multiplier}x</span>
              </div>
              <div class="history-meta">
                <span class="history-result">${item.result}</span>
                <span>${formatTime(item.at)}</span>
              </div>
            </li>
          `;
        })
        .join("");

      return `
        <li class="session-group">
          <button
            class="session-toggle ${isExpanded ? "expanded" : ""}"
            type="button"
            data-session="${group.id}"
            aria-expanded="${isExpanded ? "true" : "false"}"
          >
            <div class="history-main">
              <span class="session-caret">${isExpanded ? "▾" : "▸"}</span>
              <span class="session-title">${sessionLabel}</span>
              <span class="history-multiplier">${statusText}</span>
            </div>
            <div class="history-meta">
              <span class="delta ${netClass}">${formatSigned(group.net)}</span>
            </div>
          </button>
          <ul class="session-items ${isExpanded ? "" : "collapsed"}">
            ${changeRows || '<li class="history-item history-empty"><span>No actions</span></li>'}
          </ul>
        </li>
      `;
    })
    .join("");
}

function renderBaseAmount() {
  baseAmountInput.value = String(state.baseAmount);
}

function toggleQuickCalc(open) {
  quickCalcDrawerEl.classList.toggle("open", open);
  quickCalcDrawerEl.setAttribute("aria-hidden", open ? "false" : "true");
  quickCalcPanelEl.style.transform = "";
  if (!open) {
    niuSelectedCards = [];
    renderNiuHelper();
  }
}

function clampFabPosition(x, y) {
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - quickCalcToggleBtn.offsetWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - quickCalcToggleBtn.offsetHeight - margin);
  return {
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(margin, y))
  };
}

function applyFabPosition(x, y) {
  const clamped = clampFabPosition(x, y);
  quickCalcToggleBtn.style.left = `${clamped.x}px`;
  quickCalcToggleBtn.style.top = `${clamped.y}px`;
  quickCalcToggleBtn.style.right = "auto";
  quickCalcToggleBtn.style.bottom = "auto";
}

function saveFabPosition() {
  const left = parseFloat(quickCalcToggleBtn.style.left);
  const top = parseFloat(quickCalcToggleBtn.style.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return;
  localStorage.setItem(FAB_POS_KEY, JSON.stringify({ x: left, y: top }));
}

function restoreFabPosition() {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return;
    applyFabPosition(parsed.x, parsed.y);
  } catch {
    // Ignore invalid stored position.
  }
}

function onFabPointerDown(event) {
  fabPointerId = event.pointerId;
  fabDidDrag = false;
  fabPointerStartX = event.clientX;
  fabPointerStartY = event.clientY;
  const rect = quickCalcToggleBtn.getBoundingClientRect();
  fabStartX = rect.left;
  fabStartY = rect.top;
  quickCalcToggleBtn.setPointerCapture(event.pointerId);
}

function onFabPointerMove(event) {
  if (fabPointerId !== event.pointerId) return;
  const dx = event.clientX - fabPointerStartX;
  const dy = event.clientY - fabPointerStartY;
  if (!fabDidDrag && Math.hypot(dx, dy) > 6) fabDidDrag = true;
  if (!fabDidDrag) return;
  applyFabPosition(fabStartX + dx, fabStartY + dy);
}

function onFabPointerUp(event) {
  if (fabPointerId !== event.pointerId) return;
  if (fabDidDrag) {
    const rect = quickCalcToggleBtn.getBoundingClientRect();
    const margin = 8;
    const midX = rect.left + rect.width / 2;
    const snapX =
      midX < window.innerWidth / 2 ? margin : window.innerWidth - rect.width - margin;
    applyFabPosition(snapX, rect.top);
    saveFabPosition();
    suppressFabClick = true;
  }
  fabPointerId = null;
}

function onDrawerTouchStart(event) {
  if (!quickCalcDrawerEl.classList.contains("open")) return;
  if (quickCalcPanelEl.scrollTop > 0) return;
  if (event.touches.length !== 1) return;
  drawerDragStartY = event.touches[0].clientY;
  drawerDragOffsetY = 0;
}

function onDrawerTouchMove(event) {
  if (drawerDragStartY === null) return;
  const currentY = event.touches[0].clientY;
  drawerDragOffsetY = Math.max(0, currentY - drawerDragStartY);
  if (drawerDragOffsetY <= 0) return;
  quickCalcPanelEl.style.transform = `translateY(${drawerDragOffsetY}px)`;
}

function onDrawerTouchEnd() {
  if (drawerDragStartY === null) return;
  const shouldClose = drawerDragOffsetY > 90;
  drawerDragStartY = null;
  drawerDragOffsetY = 0;
  quickCalcPanelEl.style.transform = "";
  if (shouldClose) toggleQuickCalc(false);
}

function cardLabel(card) {
  if (card.rank === "A" && card.suit === "S") return "A♠";
  return `${card.rank}`;
}

function suitPoolForRank(rank) {
  // A Spade is an explicit separate button.
  if (rank === "A") return ["H", "D", "C"];
  return ["S", "H", "D", "C"];
}

function rankNumeric(rank) {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return Number(rank);
}

function cardPointOptions(card) {
  if (card.rank === "A") return [1];
  if (card.rank === "J" || card.rank === "Q" || card.rank === "K" || card.rank === "10") return [10];
  const value = Number(card.rank);
  if (value === 3 || value === 6) return [3, 6];
  return [value];
}

function allSums(cards) {
  let sums = [0];
  for (const card of cards) {
    const options = cardPointOptions(card);
    const next = [];
    for (const current of sums) {
      for (const value of options) next.push(current + value);
    }
    sums = next;
  }
  return sums;
}

function bottomIsValid(bottomCards) {
  return allSums(bottomCards).some((sum) => sum % 10 === 0);
}

function bestNiuFromTop(topCards) {
  const values = allSums(topCards).map((sum) => {
    const mod = sum % 10;
    return mod === 0 ? 10 : mod;
  });
  return Math.max(...values);
}

function isTopHand(topCards) {
  if (topCards.length !== 2) return false;
  const hasAceSpade = topCards.some((card) => card.rank === "A" && card.suit === "S");
  const hasFace = topCards.some((card) => ["J", "Q", "K"].includes(card.rank));
  return hasAceSpade && hasFace;
}

function isPair(topCards) {
  return topCards[0].rank === topCards[1].rank && topCards[0].suit !== topCards[1].suit;
}

function compareHand(a, b) {
  if (!a) return b;
  if (b.category !== a.category) return b.category > a.category ? b : a;
  if (b.pairRank !== a.pairRank) return b.pairRank > a.pairRank ? b : a;
  if (b.niu !== a.niu) return b.niu > a.niu ? b : a;
  return a;
}

function evaluateBestNiuHand(cards) {
  if (cards.length !== 5) return null;

  const indices = [0, 1, 2, 3, 4];
  let best = null;

  for (let a = 0; a < 5; a += 1) {
    for (let b = a + 1; b < 5; b += 1) {
      for (let c = b + 1; c < 5; c += 1) {
        const bottomIdx = new Set([a, b, c]);
        const bottom = [cards[a], cards[b], cards[c]];
        if (!bottomIsValid(bottom)) continue;
        const top = indices.filter((i) => !bottomIdx.has(i)).map((i) => cards[i]);
        const topHand = isTopHand(top);
        const pair = isPair(top);
        const candidate = {
          category: topHand ? 3 : pair ? 2 : 1,
          pairRank: pair ? rankNumeric(top[0].rank) : 0,
          niu: bestNiuFromTop(top),
          bottom,
          top,
          title: ""
        };
        best = compareHand(best, candidate);
      }
    }
  }

  if (!best) return null;

  if (best.category === 3) {
    best.title = "Top Hand (A♠ + J/Q/K)";
  } else if (best.category === 2) {
    best.title = `Pair Hand (${best.top[0].rank}${best.top[0].rank})`;
  } else {
    best.title = best.niu === 10 ? "Niu Niu" : `Niu ${best.niu}`;
  }
  return best;
}

function renderCardRow(cards, rowClass) {
  if (!cards.length) return "";
  const items = cards
    .map(
      (card) => `
      <button class="niu-card-item" type="button" data-remove-card="${card.id}">
        <span>${cardLabel(card)}</span>
      </button>
    `
    )
    .join("");
  return `<div class="niu-card-row ${rowClass}">${items}</div>`;
}

function renderNiuCards() {
  niuSelectedCardsEl.classList.remove("state-valid", "state-invalid", "state-gold");

  if (!niuSelectedCards.length) {
    niuSelectedCardsEl.innerHTML = "";
    return;
  }

  if (niuSelectedCards.length === 5) {
    const best = evaluateBestNiuHand(niuSelectedCards);
    if (best) {
      const isGoldHand = best.category === 3 || best.category === 2 || best.niu === 10;
      niuSelectedCardsEl.classList.add(isGoldHand ? "state-gold" : "state-valid");
      niuSelectedCardsEl.innerHTML = `
        ${renderCardRow(best.top, "top")}
        ${renderCardRow(best.bottom, "bottom")}
      `;
      return;
    }
    niuSelectedCardsEl.classList.add("state-invalid");
  }

  niuSelectedCardsEl.innerHTML = renderCardRow(niuSelectedCards, "bottom");
}

function canAddCardType(cardType) {
  if (niuSelectedCards.length >= 5) return false;
  if (cardType === "AS") {
    return !niuSelectedCards.some((card) => card.id === "A-S");
  }
  const rank = cardType;
  const suitPool = suitPoolForRank(rank);
  const used = niuSelectedCards.filter((card) => card.rank === rank).length;
  return used < suitPool.length;
}

function renderNiuButtonsState() {
  const buttons = niuRankButtonsEl.querySelectorAll("button[data-card-type]");
  for (const button of buttons) {
    const cardType = button.dataset.cardType;
    if (!cardType) continue;
    const enabled = canAddCardType(cardType);
    button.disabled = !enabled;
    button.classList.toggle("is-disabled", !enabled);
  }
}

function renderNiuStatus() {
  const count = niuSelectedCards.length;
  if (count < 5) {
    niuStatusEl.textContent = `${count}/5 selected. Choose ${5 - count} more card(s).`;
  } else {
    const best = evaluateBestNiuHand(niuSelectedCards);
    niuStatusEl.textContent = best
      ? "5/5 selected. Cards arranged to best hand."
      : "5/5 selected. No valid 牛 formation.";
  }
  niuUndoCardBtn.disabled = count === 0;
}

function renderNiuHelper() {
  renderNiuButtonsState();
  renderNiuStatus();
  renderNiuCards();
}

function addNiuCardByType(cardType) {
  if (niuSelectedCards.length >= 5) return;

  if (cardType === "AS") {
    if (niuSelectedCards.some((card) => card.id === "A-S")) return;
    niuSelectedCards.push({ id: "A-S", rank: "A", suit: "S" });
    renderNiuHelper();
    return;
  }

  const rank = cardType;
  const suitPool = suitPoolForRank(rank);
  const usedSuits = new Set(niuSelectedCards.filter((card) => card.rank === rank).map((card) => card.suit));
  const suit = suitPool.find((candidate) => !usedSuits.has(candidate));
  if (!suit) return;

  niuSelectedCards.push({ id: `${rank}-${suit}`, rank, suit });
  renderNiuHelper();
}

function animateScoreIfChanged() {
  if (state.score === lastRenderedScore) return;
  scoreEl.classList.remove("score-pop");
  void scoreEl.offsetWidth;
  scoreEl.classList.add("score-pop");
  lastRenderedScore = state.score;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return false;
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
    return true;
  } catch {
    wakeLockSentinel = null;
    return false;
  }
}

function render() {
  scoreEl.textContent = String(state.score);
  const currentTopHistoryId = state.history[0]?.id ?? null;
  const animateHistoryId =
    currentTopHistoryId && currentTopHistoryId !== lastTopHistoryId ? currentTopHistoryId : null;
  renderHistory(animateHistoryId);
  lastTopHistoryId = currentTopHistoryId;
  renderBaseAmount();
  animateScoreIfChanged();
}

plus1xBtn.addEventListener("click", () => applyChange(1, 1, "plus1x"));
minus1xBtn.addEventListener("click", () => applyChange(1, -1, "minus1x"));
rightMultipliersEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const multiplier = clamp(toInteger(target.dataset.multiplier, 2), 2, 8);
  const sign = toInteger(target.dataset.sign, 1) >= 0 ? 1 : -1;
  const source = sign > 0 ? `plus${multiplier}x` : `minus${multiplier}x`;
  applyChange(multiplier, sign, source);
});

baseAmountInput.addEventListener("change", () => {
  const nextBase = clamp(toInteger(baseAmountInput.value, state.baseAmount), 1, 999999);
  state.baseAmount = nextBase;
  saveState();
  render();
});

clearHistoryBtn.addEventListener("click", () => {
  const ok = window.confirm("Clear all history?");
  if (!ok) return;
  state.score = 0;
  state.sessionNumber = 1;
  state.sessionStartedAt = new Date().toISOString();
  state.sessionPendingStart = false;
  state.sessionEarned = 0;
  state.sessionLost = 0;
  state.history = [];
  expandedSessions.clear();
  expandedSessions.add(state.sessionNumber);
  saveState();
  render();
});

doneSessionBtn.addEventListener("click", () => {
  if (state.sessionPendingStart) return;
  const ok = window.confirm("End current session?");
  if (!ok) return;

  const net = state.sessionEarned - state.sessionLost;
  const endedAt = new Date().toISOString();
  state.history.unshift({
    id: crypto.randomUUID(),
    type: "session",
    session: state.sessionNumber,
    startedAt: state.sessionStartedAt,
    endedAt,
    earned: state.sessionEarned,
    lost: state.sessionLost,
    net,
    at: endedAt
  });

  state.score = 0;
  state.sessionPendingStart = true;
  state.sessionEarned = 0;
  state.sessionLost = 0;
  expandedSessions.clear();
  saveState();
  render();
});

historyListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const toggle = target.closest(".session-toggle");
  if (!(toggle instanceof HTMLButtonElement)) return;
  const sessionId = clamp(toInteger(toggle.dataset.session, state.sessionNumber), 1, 999999);
  if (expandedSessions.has(sessionId)) {
    expandedSessions.delete(sessionId);
  } else {
    expandedSessions.add(sessionId);
  }
  render();
});

toggleHistoryBtn.addEventListener("click", () => {
  historySectionEl.classList.toggle("expanded");
  const expanded = historySectionEl.classList.contains("expanded");
  toggleHistoryBtn.textContent = expanded ? "Collapse" : "Expand";
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  if (wakeLockSentinel) return;
  await requestWakeLock();
});

render();
requestWakeLock();
renderNiuHelper();
restoreFabPosition();

quickCalcToggleBtn.addEventListener("click", () => {
  if (suppressFabClick) {
    suppressFabClick = false;
    return;
  }
  toggleQuickCalc(true);
});

quickCalcToggleBtn.addEventListener("pointerdown", onFabPointerDown);
quickCalcToggleBtn.addEventListener("pointermove", onFabPointerMove);
quickCalcToggleBtn.addEventListener("pointerup", onFabPointerUp);
quickCalcToggleBtn.addEventListener("pointercancel", onFabPointerUp);

window.addEventListener("resize", () => {
  const left = parseFloat(quickCalcToggleBtn.style.left);
  const top = parseFloat(quickCalcToggleBtn.style.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return;
  applyFabPosition(left, top);
  saveFabPosition();
});

quickCalcCloseBtn.addEventListener("click", () => {
  toggleQuickCalc(false);
});

quickCalcDrawerEl.addEventListener("click", (event) => {
  if (event.target === quickCalcDrawerEl) toggleQuickCalc(false);
});

quickCalcPanelEl.addEventListener("touchstart", onDrawerTouchStart, { passive: true });
quickCalcPanelEl.addEventListener("touchmove", onDrawerTouchMove, { passive: true });
quickCalcPanelEl.addEventListener("touchend", onDrawerTouchEnd);
quickCalcPanelEl.addEventListener("touchcancel", onDrawerTouchEnd);

niuRankButtonsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const cardType = target.dataset.cardType;
  if (!cardType) return;
  addNiuCardByType(cardType);
});

niuClearCardsBtn.addEventListener("click", () => {
  niuSelectedCards = [];
  renderNiuHelper();
});

niuUndoCardBtn.addEventListener("click", () => {
  if (!niuSelectedCards.length) return;
  niuSelectedCards.pop();
  renderNiuHelper();
});

niuSelectedCardsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const chip = target.closest("[data-remove-card]");
  if (!(chip instanceof HTMLElement)) return;
  const id = chip.dataset.removeCard;
  if (!id) return;
  niuSelectedCards = niuSelectedCards.filter((card) => card.id !== id);
  renderNiuHelper();
});
