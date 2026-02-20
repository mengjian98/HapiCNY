const STORAGE_KEY = "card-point-calculator-state-v1";
const FAB_POS_KEY = "card-point-calculator-fab-pos-v1";

const DEFAULT_STATE = {
  score: 0,
  baseAmount: 1,
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
const confirmDialogEl = document.getElementById("confirm-dialog");
const confirmMessageEl = document.getElementById("confirm-message");
const confirmOkBtn = document.getElementById("confirm-ok");
const confirmCancelBtn = document.getElementById("confirm-cancel");

function showConfirm(message) {
  return new Promise((resolve) => {
    confirmMessageEl.textContent = message;
    confirmDialogEl.classList.add("visible");
    confirmDialogEl.setAttribute("aria-hidden", "false");
    confirmOkBtn.focus();

    function cleanup(result) {
      confirmOkBtn.removeEventListener("click", onOk);
      confirmCancelBtn.removeEventListener("click", onCancel);
      confirmDialogEl.removeEventListener("click", onBackdrop);
      confirmDialogEl.classList.remove("visible");
      confirmDialogEl.setAttribute("aria-hidden", "true");
      resolve(result);
    }

    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === confirmDialogEl) cleanup(false); }

    confirmOkBtn.addEventListener("click", onOk);
    confirmCancelBtn.addEventListener("click", onCancel);
    confirmDialogEl.addEventListener("click", onBackdrop);
  });
}

const noSleep = new NoSleep();
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
let swipeOpenId = null;
let swipeTrack = null;

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
  swipeOpenId = null;
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
      const sessionLabel = formatSessionLabel(group.startedAt);

      const changeRows = group.changes
        .map((item) => {
          const deltaClass = item.delta >= 0 ? "plus" : "minus";
          const enterClass = animateId && animateId === item.id ? "history-enter" : "";
          return `
            <li class="history-swipe-wrapper ${enterClass}" data-history-id="${item.id}">
              <div class="history-item history-swipe-content">
                <div class="history-main">
                  <span class="delta ${deltaClass}">${formatSigned(item.delta)}</span>
                  <span class="history-multiplier">${item.multiplier}x</span>
                </div>
                <div class="history-meta">
                  <span class="history-result">${item.result}</span>
                  <span>${formatTime(item.at)}</span>
                </div>
              </div>
              <button class="history-delete-btn" type="button">Delete</button>
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

function renderCardRow(cards, rowClass, rearranged = false) {
  if (!cards.length) return "";
  const extraClass = rearranged ? "card-rearrange" : "";
  const items = cards
    .map(
      (card) => `
      <button class="niu-card-item ${extraClass}" type="button" data-remove-card="${card.id}">
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
        <div class="niu-hand-label">${best.title}</div>
        ${renderCardRow(best.top, "top", true)}
        ${renderCardRow(best.bottom, "bottom", true)}
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

const debugOverlay = document.getElementById("debug-overlay");

function debugLog(msg, isError) {
  const line = document.createElement("div");
  if (isError) line.className = "debug-err";
  line.textContent = msg;
  debugOverlay.appendChild(line);
  debugOverlay.scrollTop = debugOverlay.scrollHeight;
}

function enableNoSleep() {
  debugLog("[NoSleep] attempting enable...");
  debugLog("[NoSleep] wakeLock API available: " + ("wakeLock" in navigator));
  debugLog("[NoSleep] noSleepVideo exists: " + !!noSleep.noSleepVideo);
  debugLog("[NoSleep] noSleepTimer exists: " + !!noSleep.noSleepTimer);
  noSleep.enable().then(() => {
    debugLog("[NoSleep] enabled successfully, isEnabled: " + noSleep.isEnabled);
    if (noSleep.noSleepVideo) {
      debugLog("[NoSleep] video paused: " + noSleep.noSleepVideo.paused);
      debugLog("[NoSleep] video readyState: " + noSleep.noSleepVideo.readyState);
    }
  }).catch((err) => {
    debugLog("[NoSleep] enable failed: " + err, true);
  });
}

const allTimeStatsEl = document.getElementById("all-time-stats");

function renderAllTimeStats() {
  let totalEarned = 0;
  let totalLost = 0;
  for (const item of state.history) {
    if (item.type !== "change") continue;
    if (item.delta > 0) totalEarned += item.delta;
    else totalLost += Math.abs(item.delta);
  }
  if (totalEarned === 0 && totalLost === 0) {
    allTimeStatsEl.innerHTML = "";
    return;
  }
  const totalNet = totalEarned - totalLost;
  allTimeStatsEl.innerHTML = `
    <span class="stat-earned">+${totalEarned}</span>
    <span class="stat-lost">−${totalLost}</span>
    <span class="stat-net">Net: ${formatSigned(totalNet)}</span>
  `;
}

function closeOpenSwipe() {
  if (!swipeOpenId) return;
  const wrapper = historyListEl.querySelector(`[data-history-id="${swipeOpenId}"]`);
  if (wrapper) {
    const content = wrapper.querySelector(".history-swipe-content");
    if (content) {
      content.classList.remove("swiping");
      content.style.transform = "";
    }
  }
  swipeOpenId = null;
}

function deleteHistoryEntry(id) {
  const idx = state.history.findIndex((item) => item.id === id);
  if (idx === -1) return;

  const entry = state.history[idx];
  if (entry.type !== "change") return;

  const isCurrentSession = entry.session === state.sessionNumber && !state.sessionPendingStart;

  if (isCurrentSession) {
    state.score -= entry.delta;
    if (entry.delta > 0) state.sessionEarned = Math.max(0, state.sessionEarned - entry.delta);
    if (entry.delta < 0) state.sessionLost = Math.max(0, state.sessionLost - Math.abs(entry.delta));
  } else {
    const summary = state.history.find(
      (item) => item.type === "session" && item.session === entry.session
    );
    if (summary) {
      if (entry.delta > 0) summary.earned = Math.max(0, (summary.earned || 0) - entry.delta);
      if (entry.delta < 0) summary.lost = Math.max(0, (summary.lost || 0) - Math.abs(entry.delta));
      summary.net = (summary.earned || 0) - (summary.lost || 0);
    }
  }

  state.history.splice(idx, 1);
  swipeOpenId = null;
  saveState();
  render();
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
  renderAllTimeStats();
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

clearHistoryBtn.addEventListener("click", async () => {
  const ok = await showConfirm("Clear all history?");
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

doneSessionBtn.addEventListener("click", async () => {
  if (state.sessionPendingStart) return;
  const ok = await showConfirm("End current session?");
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

  const deleteBtn = target.closest(".history-delete-btn");
  if (deleteBtn) {
    const wrapper = deleteBtn.closest(".history-swipe-wrapper");
    if (wrapper) deleteHistoryEntry(wrapper.dataset.historyId);
    return;
  }

  if (swipeOpenId) {
    closeOpenSwipe();
    return;
  }

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

historyListEl.addEventListener("touchstart", (e) => {
  if (e.target.closest(".history-delete-btn")) return;
  const wrapper = e.target.closest(".history-swipe-wrapper");
  if (!wrapper) return;

  const touch = e.touches[0];
  const contentEl = wrapper.querySelector(".history-swipe-content");
  if (!contentEl) return;

  swipeTrack = {
    startX: touch.clientX,
    startY: touch.clientY,
    id: wrapper.dataset.historyId,
    contentEl,
    locked: null,
    currentX: 0
  };
}, { passive: true });

historyListEl.addEventListener("touchmove", (e) => {
  if (!swipeTrack) return;

  const touch = e.touches[0];
  const dx = touch.clientX - swipeTrack.startX;
  const dy = touch.clientY - swipeTrack.startY;

  if (swipeTrack.locked === null) {
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      swipeTrack.locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (swipeTrack.locked === "h") {
        swipeTrack.contentEl.classList.add("swiping");
        if (swipeOpenId && swipeOpenId !== swipeTrack.id) closeOpenSwipe();
      }
    }
    return;
  }

  if (swipeTrack.locked !== "h") return;

  const baseX = swipeOpenId === swipeTrack.id ? -76 : 0;
  const translateX = Math.min(0, Math.max(-76, baseX + dx));
  swipeTrack.currentX = translateX;
  swipeTrack.contentEl.style.transform = `translateX(${translateX}px)`;
}, { passive: true });

historyListEl.addEventListener("touchend", () => {
  if (!swipeTrack) return;
  const track = swipeTrack;
  swipeTrack = null;

  if (track.locked !== "h") return;

  track.contentEl.classList.remove("swiping");

  if (track.currentX <= -38) {
    track.contentEl.style.transform = "translateX(-76px)";
    swipeOpenId = track.id;
  } else {
    track.contentEl.style.transform = "";
    if (swipeOpenId === track.id) swipeOpenId = null;
  }
});

historyListEl.addEventListener("touchcancel", () => {
  if (!swipeTrack) return;
  swipeTrack.contentEl.classList.remove("swiping");
  swipeTrack.contentEl.style.transform = swipeOpenId === swipeTrack.id ? "translateX(-76px)" : "";
  swipeTrack = null;
});

const historyBackdropEl = document.getElementById("history-backdrop");

toggleHistoryBtn.addEventListener("click", () => {
  historySectionEl.classList.toggle("expanded");
  const expanded = historySectionEl.classList.contains("expanded");
  toggleHistoryBtn.textContent = expanded ? "Collapse" : "Expand";
  historyBackdropEl.classList.toggle("visible", expanded);
});

historyBackdropEl.addEventListener("click", () => {
  historySectionEl.classList.remove("expanded");
  toggleHistoryBtn.textContent = "Expand";
  historyBackdropEl.classList.remove("visible");
});

render();

document.addEventListener("pointerdown", function onFirstGesture() {
  document.removeEventListener("pointerdown", onFirstGesture);
  enableNoSleep();
}, { once: true });

renderNiuHelper();
restoreFabPosition();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js");
}

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

// ── Tutorial ────────────────────────────────────────
const TUTORIAL_SEEN_KEY = "card-point-calculator-tutorial-seen-v1";

const tutorialSteps = [
  {
    target: ".score-panel",
    title: "Your Score",
    desc: "This is your current point total. It updates in real time as you win or lose rounds. Below it you'll see all-time stats once you start playing.",
    position: "below"
  },
  {
    target: ".base-inline",
    title: "Set Your Base Bet",
    desc: "Enter the base amount for each round. All the multiplier buttons use this value. Tap the number to change it.",
    position: "right"
  },
  {
    target: "#plus-1x",
    title: "Quick +1x",
    desc: "Tap this to add 1\u00d7 your base amount to the score. Use it for simple 1\u00d7 wins.",
    position: "right"
  },
  {
    target: "#minus-1x",
    title: "Quick \u22121x",
    desc: "Tap this to subtract 1\u00d7 your base amount. Use it for simple 1\u00d7 losses.",
    position: "right"
  },
  {
    target: ".right-multipliers",
    title: "Multiplier Buttons",
    desc: "Green buttons add, red buttons subtract. Each pair is a multiplier (2x\u20138x) applied to your base bet. For example, if base is 100 and you tap +3x, you gain 300.",
    position: "left"
  },
  {
    target: ".history",
    title: "History & Sessions",
    desc: "All your point changes appear here, grouped by session. Tap \"Expand\" for full screen view. Swipe left on any entry to delete it.",
    position: "above"
  },
  {
    target: "#done-session",
    title: "End Session",
    desc: "Tap this when you're done playing. It saves the session summary, resets your score to 0, and starts a new session.",
    position: "below"
  },
  {
    target: ".quick-calc-fab",
    title: "Niu Niu Helper (\u725b)",
    desc: "Tap this floating button to open the Niu Niu hand evaluator. Pick 5 cards and it will find the best hand combination for you. You can drag this button around the screen.",
    position: "left"
  },
  {
    target: ".help-fab",
    title: "That's It!",
    desc: "You're all set! Your data saves automatically in the browser. Tap the \"?\" button anytime to replay this tutorial. Enjoy the game!",
    position: "right"
  }
];

const tutorialOverlay = document.getElementById("tutorial-overlay");
const tutorialSpotlight = document.getElementById("tutorial-spotlight");
const tutorialTooltip = document.getElementById("tutorial-tooltip");
const tutorialTitle = document.getElementById("tutorial-title");
const tutorialDesc = document.getElementById("tutorial-desc");
const tutorialStepIndicator = document.getElementById("tutorial-step-indicator");
const tutorialNextBtn = document.getElementById("tutorial-next");
const tutorialPrevBtn = document.getElementById("tutorial-prev");
const tutorialSkipBtn = document.getElementById("tutorial-skip");
const helpBtn = document.getElementById("help-btn");

let tutorialCurrentStep = 0;

function buildDots() {
  tutorialStepIndicator.innerHTML = tutorialSteps
    .map((_, i) => `<span class="tutorial-dot" data-dot="${i}"></span>`)
    .join("");
}

function updateDots(stepIndex) {
  const dots = tutorialStepIndicator.querySelectorAll(".tutorial-dot");
  dots.forEach((dot, i) => {
    dot.classList.toggle("active", i === stepIndex);
    dot.classList.toggle("done", i < stepIndex);
  });
}

function computeTooltipPos(targetRect, position, tooltipW, tooltipH) {
  const pad = 14;
  let top, left;
  switch (position) {
    case "below":
      top = targetRect.bottom + pad;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      break;
    case "above":
      top = targetRect.top - tooltipH - pad;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      break;
    case "left":
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.left - tooltipW - pad;
      break;
    case "right":
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.right + pad;
      break;
  }
  left = Math.max(14, Math.min(left, window.innerWidth - tooltipW - 14));
  top = Math.max(14, Math.min(top, window.innerHeight - tooltipH - 14));
  return { top, left };
}

function rectsOverlap(a, b) {
  return !(a.left >= b.right || a.right <= b.left || a.top >= b.bottom || a.bottom <= b.top);
}

function positionTooltip(targetRect, preferredPos) {
  const tooltipW = tutorialTooltip.offsetWidth;
  const tooltipH = tutorialTooltip.offsetHeight;
  const spotPad = 6;
  const spotRect = {
    top: targetRect.top - spotPad,
    left: targetRect.left - spotPad,
    right: targetRect.right + spotPad,
    bottom: targetRect.bottom + spotPad
  };

  const order = [preferredPos, "below", "above", "right", "left"].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );

  for (const pos of order) {
    const { top, left } = computeTooltipPos(targetRect, pos, tooltipW, tooltipH);
    const tipRect = { top, left, right: left + tooltipW, bottom: top + tooltipH };
    if (!rectsOverlap(tipRect, spotRect)) {
      tutorialTooltip.style.top = `${top}px`;
      tutorialTooltip.style.left = `${left}px`;
      return;
    }
  }

  const fallback = computeTooltipPos(targetRect, "below", tooltipW, tooltipH);
  tutorialTooltip.style.top = `${fallback.top}px`;
  tutorialTooltip.style.left = `${fallback.left}px`;
}

function showTutorialStep(index) {
  tutorialCurrentStep = index;
  const step = tutorialSteps[index];
  const el = document.querySelector(step.target);

  if (!el) return;

  const rect = el.getBoundingClientRect();
  const spotPad = 6;

  tutorialSpotlight.style.top = `${rect.top - spotPad}px`;
  tutorialSpotlight.style.left = `${rect.left - spotPad}px`;
  tutorialSpotlight.style.width = `${rect.width + spotPad * 2}px`;
  tutorialSpotlight.style.height = `${rect.height + spotPad * 2}px`;
  tutorialSpotlight.classList.toggle("pulse", index === 0);

  tutorialTitle.textContent = step.title;
  tutorialDesc.textContent = step.desc;
  updateDots(index);

  tutorialPrevBtn.style.display = index === 0 ? "none" : "";
  tutorialNextBtn.textContent = index === tutorialSteps.length - 1 ? "Done" : "Next";
  tutorialSkipBtn.style.display = index === tutorialSteps.length - 1 ? "none" : "";

  requestAnimationFrame(() => positionTooltip(rect, step.position));
}

function startTutorial() {
  buildDots();
  tutorialOverlay.classList.add("active");
  tutorialOverlay.setAttribute("aria-hidden", "false");
  showTutorialStep(0);
}

function endTutorial() {
  tutorialOverlay.classList.remove("active");
  tutorialOverlay.setAttribute("aria-hidden", "true");
  localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
}

tutorialNextBtn.addEventListener("click", () => {
  if (tutorialCurrentStep < tutorialSteps.length - 1) {
    showTutorialStep(tutorialCurrentStep + 1);
  } else {
    endTutorial();
  }
});

tutorialPrevBtn.addEventListener("click", () => {
  if (tutorialCurrentStep > 0) {
    showTutorialStep(tutorialCurrentStep - 1);
  }
});

tutorialSkipBtn.addEventListener("click", endTutorial);

tutorialOverlay.addEventListener("click", (e) => {
  if (e.target === tutorialOverlay) endTutorial();
});

helpBtn.addEventListener("click", startTutorial);

window.addEventListener("resize", () => {
  if (!tutorialOverlay.classList.contains("active")) return;
  showTutorialStep(tutorialCurrentStep);
});

if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) {
  startTutorial();
}
