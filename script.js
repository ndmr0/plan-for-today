const STORAGE_KEY = "planForToday.currentDay";
const PREFS_KEY = "planForToday.preferences";
const HEADLINE_KEY = "planForToday.headline";
const STATUS_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "progress", label: "In progress" },
  { value: "done", label: "Done" },
];
const MAX_TASK_TITLE_LENGTH = 120;
const UNDO_TIMEOUT_MS = 7000;
const TIME_STEP_MINUTES = 15;
const DAILY_HEADLINES = [
  "Build momentum today",
  "Turn focus into progress",
  "Start clear, finish lighter",
  "Choose the next right task",
  "Make steady progress today",
  "Keep the day moving",
  "Small steps, real wins",
  "Shape a focused day",
  "Move through the plan",
  "Clear work, calm pace",
  "Make today count clearly",
  "Begin with what matters",
];

const state = {
  tasks: [],
  dateKey: getDateKey(),
  visualDateKey: getDateKey(),
  expandedTaskId: null,
  draggedTaskId: null,
  dragOverTaskId: null,
  dragDropPosition: "before",
  isAddingInline: false,
  currentBatchTaskIds: [],
  batchDraggedTaskId: null,
  storageAvailable: true,
  pendingExternalChange: false,
  pendingUndo: null,
  undoTimerId: null,
  currentHeadline: "",
  prefs: {
    name: "",
  },
};

const elements = {
  todayDate: document.querySelector("#todayDate"),
  clockTime: document.querySelector("#clockTime"),
  planTitle: document.querySelector("#planTitle"),
  greetingText: document.querySelector("#greetingText"),
  greetingNameText: document.querySelector("#greetingNameText"),
  emptyGreetingName: document.querySelector("#emptyGreetingName"),
  editGreeting: document.querySelector("#editGreeting"),
  openAddTask: document.querySelector("#openAddTask"),
  taskModal: document.querySelector("#taskModal"),
  taskForm: document.querySelector("#taskForm"),
  taskTitleInput: document.querySelector("#taskTitleInput"),
  taskFormError: document.querySelector("#taskFormError"),
  taskCharCount: document.querySelector("#taskCharCount"),
  batchTaskList: document.querySelector("#batchTaskList"),
  batchEmpty: document.querySelector("#batchEmpty"),
  batchCount: document.querySelector("#batchCount"),
  closeTaskModal: document.querySelector("#closeTaskModal"),
  cancelTask: document.querySelector("#cancelTask"),
  readyForToday: document.querySelector("#readyForToday"),
  clearTasks: document.querySelector("#clearTasks"),
  clearTasksFooter: document.querySelector("#clearTasksFooter"),
  progressPanel: document.querySelector("#progressPanel"),
  progressTrack: document.querySelector("#progressTrack"),
  progressFill: document.querySelector("#progressFill"),
  progressPercent: document.querySelector("#progressPercent"),
  progressMeta: document.querySelector("#progressMeta"),
  taskList: document.querySelector("#taskList"),
  storageWarning: document.querySelector("#storageWarning"),
  syncBanner: document.querySelector("#syncBanner"),
  modalSyncBanner: document.querySelector("#modalSyncBanner"),
  applyExternalChanges: document.querySelector("#applyExternalChanges"),
  applyExternalChangesModal: document.querySelector("#applyExternalChangesModal"),
  liveRegion: document.querySelector("#liveRegion"),
  emptyState: document.querySelector("#emptyState"),
  rolloverBanner: document.querySelector("#rolloverBanner"),
  startNewDay: document.querySelector("#startNewDay"),
  confirmModal: document.querySelector("#confirmModal"),
  confirmForm: document.querySelector("#confirmForm"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmMessage: document.querySelector("#confirmMessage"),
  confirmAction: document.querySelector("#confirmAction"),
  closeConfirmModal: document.querySelector("#closeConfirmModal"),
  cancelConfirm: document.querySelector("#cancelConfirm"),
  undoToast: document.querySelector("#undoToast"),
  undoMessage: document.querySelector("#undoMessage"),
  undoDelete: document.querySelector("#undoDelete"),
};

let pendingConfirmAction = null;

init();

function init() {
  state.storageAvailable = testStorageAvailability();
  loadPrefs();
  chooseNextHeadline();
  loadTasks();
  bindEvents();
  render();
  setInterval(renderClock, 1000);
  setInterval(handleClockTick, 60000);
  setInterval(checkDateRollover, 60000);
}

function bindEvents() {
  elements.openAddTask?.addEventListener("click", startInlineAdd);
  elements.emptyState?.addEventListener("click", startInlineAdd);
  elements.emptyState?.addEventListener("keydown", handleEmptyStateKeydown);
  elements.closeTaskModal.addEventListener("click", closeTaskModal);
  elements.cancelTask.addEventListener("click", closeTaskModal);
  elements.readyForToday.addEventListener("click", closeTaskModal);
  elements.taskForm.addEventListener("submit", handleTaskSubmit);
  elements.taskTitleInput.addEventListener("input", () => {
    clearTaskFormError();
    updateTaskCharacterCount();
  });
  elements.taskModal.addEventListener("cancel", resetTaskForm);
  elements.taskModal.addEventListener("close", endTaskModalSession);
  elements.applyExternalChanges.addEventListener("click", applyExternalStorageChanges);
  elements.applyExternalChangesModal.addEventListener("click", applyExternalStorageChanges);
  elements.undoDelete.addEventListener("click", undoLastDelete);
  window.addEventListener("storage", handleStorageEvent);

  elements.clearTasks?.addEventListener("click", () => {
    if (!state.tasks.length) return;
    openConfirm(() => {
      clearUndoToast();
      state.tasks = [];
      state.expandedTaskId = null;
      state.isAddingInline = false;
      saveTasks();
      render();
      announce("Today cleared.");
    });
  });

  elements.confirmForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pendingConfirmAction) pendingConfirmAction();
    pendingConfirmAction = null;
    closeDialog(elements.confirmModal);
  });
  elements.closeConfirmModal.addEventListener("click", closeConfirm);
  elements.cancelConfirm.addEventListener("click", closeConfirm);
  elements.confirmModal.addEventListener("cancel", () => {
    pendingConfirmAction = null;
  });

  elements.editGreeting?.addEventListener("click", editGreeting);
  elements.greetingNameText?.addEventListener("blur", saveGreetingFromInlineEdit);
  elements.greetingNameText?.addEventListener("keydown", handleGreetingKeydown);

  elements.startNewDay.addEventListener("click", requestStartFreshDay);
}

function handleEmptyStateKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  startInlineAdd();
}

function handleTaskSubmit(event) {
  event.preventDefault();
  const title = elements.taskTitleInput.value.trim().replace(/\s+/g, " ");
  if (!title) {
    elements.taskFormError.textContent = "Enter a task name first.";
    elements.taskTitleInput.setAttribute("aria-invalid", "true");
    announce("Enter a task name first.");
    elements.taskTitleInput.focus();
    return;
  }

  const task = addTask(title);
  state.currentBatchTaskIds.push(task.id);
  renderBatchList();
  resetTaskForm();
  announce(`${task.title} added.`);
  requestAnimationFrame(() => elements.taskTitleInput.focus());
}

function addTask(title) {
  const task = {
    id: createTaskId(),
    title,
    status: "todo",
    startTime: "",
    endTime: "",
    createdAt: new Date().toISOString(),
  };

  state.tasks.push(task);
  saveTasks();
  render();
  return task;
}

function startInlineAdd() {
  state.isAddingInline = true;
  renderTasks();
  requestAnimationFrame(() => {
    const input = elements.taskList.querySelector(".inline-add-input");
    input?.focus();
  });
}

function closeInlineAdd() {
  state.isAddingInline = false;
  const input = elements.taskList.querySelector(".inline-add-input");
  if (input) {
    input.value = "";
    input.blur();
  }
  if (!state.tasks.length) renderTasks();
}

function saveInlineTask(input) {
  const title = input.value.trim().replace(/\s+/g, " ");
  if (!title) {
    input.value = "";
    input.focus();
    announce("Enter a task name first.");
    return;
  }

  const task = addTask(title.slice(0, MAX_TASK_TITLE_LENGTH));
  state.isAddingInline = true;
  renderTasks();
  announce(`${task.title} added.`);
  requestAnimationFrame(() => {
    const nextInput = elements.taskList.querySelector(".inline-add-input");
    nextInput?.focus();
  });
}

function openTaskModal() {
  state.currentBatchTaskIds = [];
  state.batchDraggedTaskId = null;
  resetTaskForm();
  renderBatchList();
  openDialog(elements.taskModal);
  requestAnimationFrame(() => elements.taskTitleInput.focus());
}

function closeTaskModal() {
  endTaskModalSession();
  closeDialog(elements.taskModal);
}

function endTaskModalSession() {
  resetTaskForm();
  state.currentBatchTaskIds = [];
  state.batchDraggedTaskId = null;
  renderBatchList();
  renderSyncBanner();
}

function resetTaskForm() {
  elements.taskForm.reset();
  clearTaskFormError();
  updateTaskCharacterCount();
}

function clearTaskFormError() {
  elements.taskFormError.textContent = "";
  elements.taskTitleInput.removeAttribute("aria-invalid");
}

function updateTaskCharacterCount() {
  const length = elements.taskTitleInput.value.length;
  elements.taskCharCount.textContent = `${length}/${MAX_TASK_TITLE_LENGTH}`;
}

function renderBatchList() {
  elements.batchTaskList.innerHTML = "";

  const batchTasks = getBatchTasks();
  elements.batchEmpty.hidden = batchTasks.length > 0;
  elements.batchCount.textContent = `${batchTasks.length} ${batchTasks.length === 1 ? "task" : "tasks"}`;

  batchTasks.forEach((task, index) => {
    elements.batchTaskList.appendChild(createBatchTaskItem(task, index));
  });
}

function getBatchTasks() {
  const tasksById = new Map(state.tasks.map((task) => [task.id, task]));
  return state.currentBatchTaskIds.map((taskId) => tasksById.get(taskId)).filter(Boolean);
}

function createBatchTaskItem(task, index) {
  const item = document.createElement("article");
  item.className = "batch-task";
  item.dataset.taskId = task.id;

  const dragHandle = document.createElement("button");
  dragHandle.className = "batch-drag-handle";
  dragHandle.type = "button";
  dragHandle.draggable = true;
  dragHandle.title = "Drag to reorder this batch";
  dragHandle.setAttribute("aria-label", `Reorder ${task.title}`);
  dragHandle.textContent = "⋮⋮";
  dragHandle.addEventListener("dragstart", (event) => handleBatchDragStart(event, task.id));
  dragHandle.addEventListener("dragend", handleBatchDragEnd);

  const number = document.createElement("span");
  number.className = "batch-number";
  number.textContent = String(index + 1).padStart(2, "0");

  const title = document.createElement("p");
  title.className = "batch-task-title";
  title.textContent = task.title;

  const controls = document.createElement("div");
  controls.className = "batch-controls";

  const moveUpButton = document.createElement("button");
  moveUpButton.className = "time-button batch-move";
  moveUpButton.type = "button";
  moveUpButton.disabled = index <= 0;
  moveUpButton.innerHTML = '<span aria-hidden="true">↑</span> Move up';
  moveUpButton.setAttribute("aria-label", `Move ${task.title} up in this batch`);
  moveUpButton.addEventListener("click", () => moveBatchTask(task.id, -1));

  const moveDownButton = document.createElement("button");
  moveDownButton.className = "time-button batch-move";
  moveDownButton.type = "button";
  moveDownButton.disabled = index >= getBatchTasks().length - 1;
  moveDownButton.innerHTML = '<span aria-hidden="true">↓</span> Move down';
  moveDownButton.setAttribute("aria-label", `Move ${task.title} down in this batch`);
  moveDownButton.addEventListener("click", () => moveBatchTask(task.id, 1));

  const deleteButton = document.createElement("button");
  deleteButton.className = "icon-button batch-delete";
  deleteButton.type = "button";
  deleteButton.title = "Delete";
  deleteButton.setAttribute("aria-label", `Delete ${task.title}`);
  deleteButton.appendChild(createIcon("trash"));
  deleteButton.addEventListener("click", () => requestDeleteTask(task.id));

  controls.append(moveUpButton, moveDownButton);
  item.append(dragHandle, number, title, controls, deleteButton);
  item.addEventListener("dragover", (event) => handleBatchDragOver(event, task.id));
  item.addEventListener("drop", (event) => handleBatchDrop(event, task.id));

  return item;
}

function openConfirm(action, options = {}) {
  pendingConfirmAction = action;
  elements.confirmTitle.textContent = options.title || "Clear today?";
  elements.confirmMessage.textContent = options.message || "This removes every task in today's stack.";
  elements.confirmAction.textContent = options.actionLabel || "Clear";
  openDialog(elements.confirmModal);
}

function closeConfirm() {
  pendingConfirmAction = null;
  closeDialog(elements.confirmModal);
}

function editGreeting() {
  elements.greetingNameText.contentEditable = "true";
  elements.greetingNameText.focus();

  const range = document.createRange();
  range.selectNodeContents(elements.greetingNameText);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function handleGreetingKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    elements.greetingNameText.blur();
  }

  if (event.key === "Escape") {
    event.preventDefault();
    renderGreeting();
    elements.greetingNameText.blur();
  }
}

function saveGreetingFromInlineEdit() {
  if (elements.greetingNameText.contentEditable !== "true") return;
  const cleaned = elements.greetingNameText.textContent.trim().replace(/\s+/g, " ");
  state.prefs.name = cleaned.slice(0, 40);
  elements.greetingNameText.contentEditable = "false";
  savePrefs();
  renderGreeting();
}

function render() {
  renderDateLine();
  renderDailyHeadline();
  renderStorageWarning();
  renderSyncBanner();
  renderGreeting();
  renderRolloverBanner();
  renderTasks();
}

function renderDateLine() {
  elements.todayDate.textContent = formatToday();
  renderClock();
}

function renderClock() {
  elements.clockTime.textContent = formatClock();
  const currentDateKey = getDateKey();
  if (state.visualDateKey === currentDateKey) return;
  state.visualDateKey = currentDateKey;
  elements.todayDate.textContent = formatToday();
  chooseNextHeadline();
  renderDailyHeadline();
  renderRolloverBanner();
}

function renderDailyHeadline() {
  if (!state.currentHeadline) chooseNextHeadline();
  if (!elements.planTitle) return;
  elements.planTitle.textContent = state.currentHeadline;
}

function renderGreeting() {
  const name = state.prefs.name || "hard worker";
  if (elements.greetingNameText) elements.greetingNameText.textContent = name;
  if (elements.emptyGreetingName) elements.emptyGreetingName.textContent = name;
}

function renderRolloverBanner() {
  elements.rolloverBanner.hidden = state.dateKey === getDateKey();
}

function renderStorageWarning() {
  elements.storageWarning.hidden = state.storageAvailable;
}

function renderSyncBanner() {
  const showPageBanner = state.pendingExternalChange && !elements.taskModal.open;
  const showModalBanner = state.pendingExternalChange && elements.taskModal.open;
  elements.syncBanner.hidden = !showPageBanner;
  elements.modalSyncBanner.hidden = !showModalBanner;
}

function announce(message) {
  if (!elements.liveRegion) return;
  elements.liveRegion.textContent = "";
  window.setTimeout(() => {
    elements.liveRegion.textContent = message;
  }, 20);
}

function renderTasks() {
  elements.taskList.innerHTML = "";
  const isEmpty = state.tasks.length === 0;
  document.body.classList.toggle("empty-plan", isEmpty);
  document.body.classList.toggle("capturing-first-task", isEmpty && state.isAddingInline);
  if (elements.emptyState) elements.emptyState.hidden = !isEmpty;
  if (elements.clearTasks) elements.clearTasks.hidden = isEmpty;
  if (elements.clearTasksFooter) elements.clearTasksFooter.hidden = isEmpty;
  renderProgress();

  state.tasks.forEach((task) => {
    elements.taskList.appendChild(createTaskCard(task));
  });

  if (!isEmpty || state.isAddingInline) {
    elements.taskList.appendChild(createInlineAddRow());
  }
}

function renderProgress() {
  const total = state.tasks.length;
  const completed = state.tasks.filter((task) => task.status === "done").length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  elements.progressPanel.hidden = total === 0;
  if (!total) return;

  const taskLabel = total === 1 ? "task" : "tasks";
  elements.progressPanel.classList.toggle("complete", percent === 100);
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressMeta.textContent = `${completed} of ${total} ${taskLabel} complete`;
  elements.progressFill.style.width = `${percent}%`;
  elements.progressTrack.setAttribute("aria-valuenow", String(percent));
  elements.progressTrack.setAttribute("aria-valuetext", `${percent}% complete`);
}

function createIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `app-icon app-icon-${name}`);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const paths = {
    check: ["M20 6 9 17l-5-5"],
    clock: ["M12 7v5l3 2", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
    edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"],
    hourglass: ["M6 3h12", "M6 21h12", "M7 3c0 5 3.5 6 5 9-1.5 3-5 4-5 9", "M17 3c0 5-3.5 6-5 9 1.5 3 5 4 5 9"],
    plus: ["M12 5v14", "M5 12h14"],
    refresh: ["M3 12a9 9 0 0 1 15.1-6.6L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-15.1 6.6L3 16", "M3 21v-5h5"],
    trash: ["M3 6h18", "M8 6V4h8v2", "M6 6l1 15h10l1-15", "M10 11v6", "M14 11v6"],
  };

  (paths[name] || []).forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
  });

  return svg;
}

function createInlineAddRow() {
  const row = document.createElement("form");
  row.className = "inline-add-row";
  row.setAttribute("aria-label", "Add a task");

  const marker = document.createElement("span");
  marker.className = "inline-add-marker";
  marker.setAttribute("aria-hidden", "true");

  const input = document.createElement("input");
  input.className = "inline-add-input";
  input.type = "text";
  input.maxLength = MAX_TASK_TITLE_LENGTH;
  input.placeholder = "Type a task...";
  input.autocomplete = "off";

  const addButton = document.createElement("button");
  addButton.className = "primary-button inline-add-button";
  addButton.type = "submit";
  addButton.append(createIcon("plus"), document.createTextNode("Add Task"));

  row.addEventListener("submit", (event) => {
    event.preventDefault();
    saveInlineTask(input);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveInlineTask(input);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeInlineAdd();
    }
  });

  row.append(marker, input, addButton);
  return row;
}

function createTaskCard(task) {
  const timing = getTaskTiming(task);
  const card = document.createElement("article");
  card.className = getCardClass(task, timing);
  card.dataset.taskId = task.id;
  card.addEventListener("dragover", (event) => handleDragOver(event, task.id));
  card.addEventListener("drop", (event) => handleDrop(event, task.id));
  card.addEventListener("dragleave", (event) => handleDragLeave(event, card));

  const row = document.createElement("div");
  row.className = "task-row";
  row.draggable = true;
  row.title = "Hold and drag to reorder";
  row.addEventListener("dragstart", (event) => handleDragStart(event, task.id));
  row.addEventListener("dragend", handleDragEnd);

  const doneToggle = createDoneToggle(task);

  const titleArea = document.createElement("div");
  titleArea.className = "task-title-area";
  titleArea.title = "Open task details";
  titleArea.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    toggleExpanded(task.id);
  });

  const titleButton = document.createElement("button");
  titleButton.className = "task-title-button";
  titleButton.type = "button";
  titleButton.textContent = task.title;
  titleButton.title = "Edit task details";
  titleButton.setAttribute("aria-expanded", String(state.expandedTaskId === task.id));
  titleButton.addEventListener("click", () => toggleExpanded(task.id));

  const editButton = createEditButton(task);
  const timerPill = createTimerPill(task, timing);

  titleArea.append(titleButton, editButton, createStatusPill(task.status));
  if (timerPill) titleArea.appendChild(timerPill);

  const deleteButton = createRowDeleteButton(task);

  row.append(doneToggle, titleArea, deleteButton);
  card.append(row, createTaskDetails(task));

  return card;
}

function createDoneToggle(task) {
  const isDone = task.status === "done";
  const button = document.createElement("button");
  button.className = `done-toggle ${isDone ? "checked" : ""}`;
  button.type = "button";
  button.title = isDone ? "Mark as not done" : "Mark as done";
  button.setAttribute("aria-label", `${isDone ? "Mark as not done" : "Mark as done"}: ${task.title}`);
  button.setAttribute("aria-pressed", String(isDone));
  button.appendChild(createIcon("check"));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleTaskDone(task.id);
  });
  return button;
}

function createStatusSegments(task) {
  const wrapper = document.createElement("div");
  wrapper.className = "status-segment-field";

  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = "Status";

  const group = document.createElement("div");
  group.className = "status-segments";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `Status for ${task.title}`);

  STATUS_OPTIONS.forEach((option) => {
    const button = document.createElement("button");
    button.className = `status-segment status-${option.value} ${option.value === task.status ? "active" : ""}`;
    button.type = "button";
    button.append(createStatusMark(option.value), document.createTextNode(option.label));
    button.setAttribute("aria-pressed", String(option.value === task.status));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setTaskStatus(task.id, option.value);
    });
    group.appendChild(button);
  });

  wrapper.append(label, group);
  return wrapper;
}

function createTimerPill(task, timing) {
  if (!timing.hasSchedule) return null;
  const pill = document.createElement("span");
  pill.className = `timer-pill ${timing.state}`;
  setTimerPillContent(pill, timing);
  pill.setAttribute("aria-label", timing.ariaLabel);
  return pill;
}

function createStatusPill(status) {
  const option = STATUS_OPTIONS.find((item) => item.value === status) || STATUS_OPTIONS[0];
  const pill = document.createElement("span");
  pill.className = `status-pill status-${option.value}`;
  pill.append(createStatusMark(option.value), document.createTextNode(option.label));
  return pill;
}

function createStatusMark(status) {
  const mark = document.createElement("span");
  mark.className = `status-mark status-mark-${status}`;
  mark.setAttribute("aria-hidden", "true");
  if (status === "progress") mark.textContent = "–";
  if (status === "done") mark.textContent = "✓";
  return mark;
}

function setTimerPillContent(pill, timing) {
  pill.textContent = "";
  const [deadline, remaining] = timing.label.split(" / ");
  pill.appendChild(createIcon("clock"));

  if (!remaining) {
    const text = document.createElement("span");
    text.className = "timer-pill-text";
    text.textContent = timing.label;
    pill.appendChild(text);
    return;
  }

  const deadlineText = document.createElement("span");
  deadlineText.className = "timer-pill-deadline";
  deadlineText.textContent = deadline;

  const separator = document.createElement("span");
  separator.className = "timer-pill-separator";
  separator.textContent = "/";

  const remainingText = document.createElement("span");
  remainingText.className = "timer-pill-remaining";
  remainingText.textContent = remaining;

  pill.append(deadlineText, separator, remainingText);
}

function createEditButton(task) {
  const button = document.createElement("button");
  button.className = "row-icon-button edit-task";
  button.type = "button";
  button.title = "Edit details";
  button.setAttribute("aria-label", `Edit ${task.title}`);
  button.appendChild(createIcon("edit"));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleExpanded(task.id);
  });
  return button;
}

function createRowDeleteButton(task) {
  const button = document.createElement("button");
  button.className = "row-icon-button row-delete-task";
  button.type = "button";
  button.title = "Delete task";
  button.setAttribute("aria-label", `Delete ${task.title}`);
  button.appendChild(createIcon("trash"));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    requestDeleteTask(task.id);
  });
  return button;
}

function createTaskDetails(task) {
  const details = document.createElement("div");
  details.className = "task-details";

  const titleField = createField("Task", "text", task.title);
  titleField.input.maxLength = 120;
  titleField.input.addEventListener("input", () => {
    persistTaskChanges(task.id, { title: titleField.input.value.trimStart().slice(0, 120) });
  });
  titleField.input.addEventListener("blur", () => {
    const title = titleField.input.value.trim().replace(/\s+/g, " ");
    updateTask(task.id, { title: title || task.title });
  });
  titleField.input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const title = titleField.input.value.trim().replace(/\s+/g, " ");
    finishTaskEditing(task.id, { title: title || task.title });
  });

  details.append(
    titleField.wrapper,
    createStatusSegments(task),
    createSchedulePanel(task),
    createDeletePanel(task)
  );
  return details;
}

function createSchedulePanel(task) {
  const panel = document.createElement("div");
  panel.className = "schedule-panel";

  const header = document.createElement("div");
  header.className = "schedule-header";

  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = "Time";

  const clearButton = document.createElement("button");
  clearButton.className = "time-button clear-time-action";
  clearButton.type = "button";
  clearButton.append(createIcon("refresh"), document.createTextNode("Clear time"));
  clearButton.addEventListener("click", () => updateTask(task.id, { startTime: "", endTime: "" }));

  const fields = document.createElement("div");
  fields.className = "schedule-fields";

  const startColumn = document.createElement("div");
  startColumn.className = "schedule-column start-column";
  const startPresets = createChipGroup("Quick start", "schedule-presets");

  [
    { label: "Now", getStart: getDefaultStartTime },
    { label: "In 15m", getStart: () => getRelativeStartTime(15) },
    { label: "In 30m", getStart: () => getRelativeStartTime(30) },
    { label: "Noon", getStart: () => "12:00" },
    { label: "5 PM", getStart: () => "17:00" },
  ].forEach((preset) => {
    const button = document.createElement("button");
    button.className = "time-preset";
    button.type = "button";
    button.textContent = preset.label;
    button.addEventListener("click", () => {
      setTaskStartTime(task.id, preset.getStart());
    });
    startPresets.appendChild(button);
  });

  startColumn.append(createTimeStepper("Start", task, "startTime"), startPresets);

  const endColumn = document.createElement("div");
  endColumn.className = "schedule-column end-column";
  const durations = createChipGroup("Quick duration", "duration-presets");
  [
    { label: "15m", minutes: 15 },
    { label: "30m", minutes: 30 },
    { label: "1h", minutes: 60 },
    { label: "2h", minutes: 120 },
    { label: "3h", minutes: 180 },
    { label: "4h", minutes: 240 },
  ].forEach((duration) => {
    const button = document.createElement("button");
    button.className = "duration-chip";
    button.type = "button";
    button.textContent = duration.label;
    button.addEventListener("click", () => {
      const startTime = task.startTime || getDefaultStartTime();
      setTaskSchedule(task.id, startTime, addMinutesToTime(startTime, duration.minutes));
    });
    durations.appendChild(button);
  });
  endColumn.append(createTimeStepper("End", task, "endTime"), durations);
  fields.append(startColumn, endColumn);

  const error = document.createElement("span");
  error.className = "field-error";
  error.textContent = "End time needs to be after start time.";

  header.append(label, clearButton);
  panel.append(header, fields, error);
  return panel;
}

function createChipGroup(label, className) {
  const group = document.createElement("div");
  group.className = className;
  const heading = document.createElement("span");
  heading.className = "chip-group-label";
  heading.textContent = label;
  group.appendChild(heading);
  return group;
}

function createTimeStepper(label, task, field) {
  const wrapper = document.createElement("div");
  wrapper.className = "time-stepper-field";

  const text = document.createElement("span");
  text.className = "field-label";
  text.append(
    createIcon(label === "Start" ? "clock" : "hourglass"),
    document.createTextNode(label === "Start" ? "Start" : "End / Duration")
  );

  const controls = document.createElement("div");
  controls.className = "time-stepper";

  const decrement = document.createElement("button");
  decrement.className = "time-step-button";
  decrement.type = "button";
  decrement.textContent = "-";
  decrement.setAttribute("aria-label", `${label} time earlier`);
  decrement.addEventListener("click", () => adjustTaskTime(task.id, field, -TIME_STEP_MINUTES));

  const display = document.createElement("button");
  display.className = `time-display ${task[field] ? "" : "empty"}`;
  display.type = "button";
  display.textContent = task[field]
    ? formatTime(getDateWithTime(task[field]))
    : `Set ${label.toLowerCase()} time`;
  display.setAttribute("aria-label", task[field] ? `${label} time ${display.textContent}` : `Set ${label.toLowerCase()} time`);
  display.addEventListener("click", () => ensureTaskTime(task.id, field));

  const increment = document.createElement("button");
  increment.className = "time-step-button";
  increment.type = "button";
  increment.textContent = "+";
  increment.setAttribute("aria-label", `${label} time later`);
  increment.addEventListener("click", () => adjustTaskTime(task.id, field, TIME_STEP_MINUTES));

  controls.append(decrement, display, increment);
  wrapper.append(text, controls);
  return wrapper;
}

function createDeletePanel(task) {
  const panel = document.createElement("div");
  panel.className = "editor-actions";

  const deleteButton = document.createElement("button");
  deleteButton.className = "task-delete-action";
  deleteButton.type = "button";
  deleteButton.append(createIcon("trash"), document.createTextNode("Delete task"));
  deleteButton.setAttribute("aria-label", `Delete ${task.title}`);
  deleteButton.addEventListener("click", () => requestDeleteTask(task.id));

  const doneButton = document.createElement("button");
  doneButton.className = "done-edit-action";
  doneButton.type = "button";
  doneButton.append(createIcon("check"), document.createTextNode("Done"));
  doneButton.setAttribute("aria-label", "Done editing task");
  doneButton.addEventListener("click", () => finishTaskEditing(task.id));

  panel.append(deleteButton, doneButton);
  return panel;
}

function createField(label, type, value, hint = "") {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = type;
  input.value = value || "";
  wrapper.append(text, input);
  if (hint) {
    const hintText = document.createElement("small");
    hintText.className = "field-hint";
    hintText.textContent = hint;
    wrapper.appendChild(hintText);
  }
  return { wrapper, input };
}

function getCardClass(task, timing) {
  const classes = ["task-item"];
  if (state.expandedTaskId === task.id) classes.push("expanded");
  if (task.status === "done") classes.push("done");
  if (!timing.isValid && task.startTime && task.endTime) classes.push("invalid-time");
  if (task.status !== "done" && timing.state) classes.push(timing.state);
  return classes.join(" ");
}

function toggleExpanded(taskId) {
  state.expandedTaskId = state.expandedTaskId === taskId ? null : taskId;
  renderTasks();
}

function toggleTaskDone(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const nextStatus = task.status === "done" ? "todo" : "done";
  updateTask(taskId, { status: nextStatus });
  announce(`${task.title} marked ${nextStatus === "done" ? "done" : "to do"}.`);
}

function setTaskStatus(taskId, status) {
  const task = state.tasks.find((item) => item.id === taskId);
  const option = STATUS_OPTIONS.find((item) => item.value === status);
  if (!task || !option) return;
  updateTask(taskId, { status });
  announce(`${task.title} set to ${option.label}.`);
}

function finishTaskEditing(taskId, changes = null) {
  if (changes) persistTaskChanges(taskId, changes);
  state.expandedTaskId = null;
  renderTasks();
  announce("Changes saved.");
}

function ensureTaskTime(taskId, field) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const startTime = task.startTime || getDefaultStartTime();
  const endTime = task.endTime || addMinutesToTime(startTime, 30);
  setTaskSchedule(taskId, startTime, endTime);
}

function setTaskStartTime(taskId, startTime) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const duration = getTaskDurationMinutes(task);
  setTaskSchedule(taskId, startTime, addMinutesToTime(startTime, duration));
}

function adjustTaskTime(taskId, field, minutes) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;

  if (field === "startTime") {
    const currentStart = task.startTime || getDefaultStartTime();
    const duration = getTaskDurationMinutes(task);
    const nextStart = addMinutesToTime(currentStart, minutes);
    setTaskSchedule(taskId, nextStart, addMinutesToTime(nextStart, duration));
    return;
  }

  const startTime = task.startTime || getDefaultStartTime();
  const currentEnd = task.endTime || addMinutesToTime(startTime, 30);
  let nextEnd = addMinutesToTime(currentEnd, minutes);
  if (timeToMinutes(nextEnd) <= timeToMinutes(startTime)) {
    nextEnd = addMinutesToTime(startTime, TIME_STEP_MINUTES);
  }
  setTaskSchedule(taskId, startTime, nextEnd);
}

function setTaskSchedule(taskId, startTime, endTime) {
  const startMinutes = timeToMinutes(startTime);
  let endMinutes = timeToMinutes(endTime);
  if (endMinutes <= startMinutes) {
    endMinutes = Math.min(startMinutes + 30, 1439);
  }
  updateTask(taskId, {
    startTime: minutesToTime(startMinutes),
    endTime: minutesToTime(endMinutes),
  });
}

function getDefaultStartTime() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.ceil(minutes / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
  return minutesToTime(Math.min(rounded, 1410));
}

function getRelativeStartTime(minutesFromNow) {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes() + minutesFromNow;
  const rounded = Math.ceil(minutes / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
  return minutesToTime(Math.min(rounded, 1439));
}

function getTaskDurationMinutes(task) {
  if (!task.startTime || !task.endTime) return 30;
  const duration = timeToMinutes(task.endTime) - timeToMinutes(task.startTime);
  return duration > 0 ? duration : 30;
}

function addMinutesToTime(time, minutes) {
  return minutesToTime(timeToMinutes(time) + minutes);
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const total = (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
  return Math.min(Math.max(total, 0), 1439);
}

function minutesToTime(minutes) {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), 1439);
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function updateTask(taskId, changes) {
  persistTaskChanges(taskId, changes);
  renderTasks();
}

function persistTaskChanges(taskId, changes) {
  state.tasks = state.tasks.map((task) => {
    if (task.id !== taskId) return task;
    return { ...task, ...changes };
  });
  saveTasks();
}

function requestDeleteTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  openConfirm(() => deleteTask(taskId), {
    title: "Delete task?",
    message: `This removes "${task.title}" from today's plan. You can still undo it right after deleting.`,
    actionLabel: "Delete task",
  });
}

function deleteTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const taskIndex = state.tasks.findIndex((item) => item.id === taskId);
  const batchIndex = state.currentBatchTaskIds.indexOf(taskId);
  state.tasks = state.tasks.filter((task) => task.id !== taskId);
  state.currentBatchTaskIds = state.currentBatchTaskIds.filter((id) => id !== taskId);
  if (state.expandedTaskId === taskId) state.expandedTaskId = null;
  saveTasks();
  render();
  if (elements.taskModal.open) renderBatchList();
  showUndoToast({ task, taskIndex, batchIndex });
  announce(`${task.title} deleted. Undo is available.`);
}

function showUndoToast(deleted) {
  if (state.undoTimerId) window.clearTimeout(state.undoTimerId);
  state.pendingUndo = deleted;
  elements.undoMessage.textContent = `${deleted.task.title} deleted.`;
  elements.undoToast.hidden = false;
  state.undoTimerId = window.setTimeout(() => {
    state.pendingUndo = null;
    state.undoTimerId = null;
    elements.undoToast.hidden = true;
  }, UNDO_TIMEOUT_MS);
}

function undoLastDelete() {
  if (!state.pendingUndo) return;
  const { task, taskIndex, batchIndex } = state.pendingUndo;
  const insertIndex = Math.min(Math.max(taskIndex, 0), state.tasks.length);
  state.tasks.splice(insertIndex, 0, task);

  if (elements.taskModal.open && batchIndex >= 0) {
    const batchInsertIndex = Math.min(Math.max(batchIndex, 0), state.currentBatchTaskIds.length);
    state.currentBatchTaskIds.splice(batchInsertIndex, 0, task.id);
  }

  state.pendingUndo = null;
  if (state.undoTimerId) window.clearTimeout(state.undoTimerId);
  state.undoTimerId = null;
  elements.undoToast.hidden = true;
  saveTasks();
  render();
  if (elements.taskModal.open) renderBatchList();
  announce(`${task.title} restored.`);
}

function clearUndoToast() {
  state.pendingUndo = null;
  if (state.undoTimerId) window.clearTimeout(state.undoTimerId);
  state.undoTimerId = null;
  elements.undoToast.hidden = true;
}

function moveTask(taskId, direction) {
  const currentIndex = state.tasks.findIndex((task) => task.id === taskId);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= state.tasks.length) return;

  const nextTasks = [...state.tasks];
  const [moved] = nextTasks.splice(currentIndex, 1);
  nextTasks.splice(nextIndex, 0, moved);
  state.tasks = nextTasks;
  saveTasks();
  renderTasks();
  announce(`${moved.title} moved ${direction < 0 ? "up" : "down"}.`);
}

function moveBatchTask(taskId, direction) {
  const currentIndex = state.currentBatchTaskIds.indexOf(taskId);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= state.currentBatchTaskIds.length) return;

  const nextBatchIds = [...state.currentBatchTaskIds];
  const [movedId] = nextBatchIds.splice(currentIndex, 1);
  nextBatchIds.splice(nextIndex, 0, movedId);
  state.currentBatchTaskIds = nextBatchIds;
  applyBatchOrderToTasks();
  saveTasks();
  renderTasks();
  renderBatchList();

  const task = state.tasks.find((item) => item.id === taskId);
  if (task) announce(`${task.title} moved ${direction < 0 ? "up" : "down"} in this batch.`);
}

function handleDragStart(event, taskId) {
  if (event.target.closest("button, input, select, textarea, .task-details")) {
    event.preventDefault();
    return;
  }

  state.draggedTaskId = taskId;
  state.dragOverTaskId = null;
  state.dragDropPosition = "before";
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", taskId);
  const card = event.target.closest(".task-item");
  requestAnimationFrame(() => card?.classList.add("dragging"));
}

function handleDragEnd() {
  state.draggedTaskId = null;
  state.dragOverTaskId = null;
  clearDropIndicators();
  document.querySelectorAll(".task-item.dragging").forEach((card) => card.classList.remove("dragging"));
}

function handleDragOver(event, targetId) {
  if (!state.draggedTaskId || state.draggedTaskId === targetId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  state.dragOverTaskId = targetId;
  state.dragDropPosition = position;
  clearDropIndicators(card);
  card.classList.toggle("drop-before", position === "before");
  card.classList.toggle("drop-after", position === "after");
}

function handleDrop(event, targetId) {
  event.preventDefault();
  const draggedId = event.dataTransfer.getData("text/plain") || state.draggedTaskId;
  if (!draggedId || draggedId === targetId) {
    clearDropIndicators();
    return;
  }

  const fromIndex = state.tasks.findIndex((task) => task.id === draggedId);
  const toIndex = state.tasks.findIndex((task) => task.id === targetId);
  if (fromIndex < 0 || toIndex < 0) {
    clearDropIndicators();
    return;
  }

  const nextTasks = [...state.tasks];
  const [moved] = nextTasks.splice(fromIndex, 1);
  let insertIndex = toIndex + (state.dragDropPosition === "after" ? 1 : 0);
  if (fromIndex < insertIndex) insertIndex -= 1;
  nextTasks.splice(insertIndex, 0, moved);
  state.tasks = nextTasks;
  state.draggedTaskId = null;
  state.dragOverTaskId = null;
  saveTasks();
  clearDropIndicators();
  renderTasks();
  announce(`${moved.title} moved.`);
}

function handleDragLeave(event, card) {
  if (card.contains(event.relatedTarget)) return;
  card.classList.remove("drop-before", "drop-after");
}

function clearDropIndicators(exceptCard = null) {
  document.querySelectorAll(".task-item.drop-before, .task-item.drop-after").forEach((card) => {
    if (card !== exceptCard) card.classList.remove("drop-before", "drop-after");
  });
}

function handleBatchDragStart(event, taskId) {
  state.batchDraggedTaskId = taskId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", taskId);
  const item = event.target.closest(".batch-task");
  requestAnimationFrame(() => item?.classList.add("dragging"));
}

function handleBatchDragEnd() {
  state.batchDraggedTaskId = null;
  document.querySelectorAll(".batch-task.dragging").forEach((item) => item.classList.remove("dragging"));
}

function handleBatchDragOver(event, targetId) {
  if (!state.batchDraggedTaskId || state.batchDraggedTaskId === targetId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function handleBatchDrop(event, targetId) {
  event.preventDefault();
  const draggedId = event.dataTransfer.getData("text/plain") || state.batchDraggedTaskId;
  if (!draggedId || draggedId === targetId) return;

  const fromIndex = state.currentBatchTaskIds.indexOf(draggedId);
  const toIndex = state.currentBatchTaskIds.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0) return;

  const nextBatchIds = [...state.currentBatchTaskIds];
  const [moved] = nextBatchIds.splice(fromIndex, 1);
  nextBatchIds.splice(toIndex, 0, moved);
  state.currentBatchTaskIds = nextBatchIds;
  applyBatchOrderToTasks();
  saveTasks();
  renderTasks();
  renderBatchList();
}

function applyBatchOrderToTasks() {
  const batchSet = new Set(state.currentBatchTaskIds);
  const tasksById = new Map(state.tasks.map((task) => [task.id, task]));
  const orderedBatchTasks = state.currentBatchTaskIds.map((taskId) => tasksById.get(taskId)).filter(Boolean);
  let batchIndex = 0;

  state.tasks = state.tasks.map((task) => {
    if (!batchSet.has(task.id)) return task;
    const replacement = orderedBatchTasks[batchIndex];
    batchIndex += 1;
    return replacement || task;
  });
}

function getTaskTiming(task) {
  if (!task.startTime || !task.endTime) {
    return { hasSchedule: false, isValid: true, state: "", label: "", ariaLabel: "" };
  }

  const start = getDateWithTime(task.startTime);
  const end = getDateWithTime(task.endTime);
  if (end <= start) {
    return {
      hasSchedule: true,
      isValid: false,
      state: "",
      label: "Check times",
      ariaLabel: "End time needs to be after start time.",
    };
  }

  if (task.status === "done") {
    return {
      hasSchedule: true,
      isValid: true,
      state: "done-time",
      label: `${formatTime(end)} / Done`,
      ariaLabel: `Done. Deadline was ${formatTime(end)}.`,
    };
  }

  const now = new Date();
  if (now > end) {
    return {
      hasSchedule: true,
      isValid: true,
      state: "late",
      label: `${formatTime(end)} / Late`,
      ariaLabel: `Late. Deadline was ${formatTime(end)}.`,
    };
  }

  const remaining = end - now;
  if (now < start) {
    return {
      hasSchedule: true,
      isValid: true,
      state: "scheduled",
      label: `${formatTime(end)} / ${formatDuration(remaining)} left`,
      ariaLabel: `Deadline ${formatTime(end)}. ${formatDuration(remaining)} remaining.`,
    };
  }

  const stateName = remaining <= 10 * 60 * 1000 ? "urgent" : remaining <= 30 * 60 * 1000 ? "warning" : "active";
  const ariaPrefix = stateName === "urgent" ? "Urgent" : stateName === "warning" ? "Due soon" : "Now";
  return {
    hasSchedule: true,
    isValid: true,
    state: stateName,
    label: `${formatTime(end)} / ${formatDuration(remaining)} left`,
    ariaLabel: `${ariaPrefix}. Deadline ${formatTime(end)}. ${formatDuration(remaining)} remaining.`,
  };
}

function handleClockTick() {
  updateTimerPills();
}

function updateTimerPills() {
  state.tasks.forEach((task) => {
    const card = getTaskCard(task.id);
    if (!card) return;

    const timing = getTaskTiming(task);
    card.classList.toggle("invalid-time", !timing.isValid && task.startTime && task.endTime);
    card.classList.remove("scheduled", "active", "warning", "urgent", "late", "done-time");
    if (task.status !== "done" && timing.state) card.classList.add(timing.state);

    const subline = card.querySelector(".task-title-area");
    let pill = card.querySelector(".timer-pill");

    if (!timing.hasSchedule) {
      pill?.remove();
      return;
    }

    if (!pill) {
      pill = document.createElement("span");
      subline?.appendChild(pill);
    }

    pill.className = `timer-pill ${timing.state}`.trim();
    setTimerPillContent(pill, timing);
    pill.setAttribute("aria-label", timing.ariaLabel);
  });
}

function getTaskCard(taskId) {
  return Array.from(elements.taskList.children).find((card) => card.dataset.taskId === taskId);
}

function checkDateRollover() {
  renderDateLine();
  if (state.dateKey !== getDateKey()) renderRolloverBanner();
}

function requestStartFreshDay() {
  openConfirm(startFreshDay, {
    title: "Start fresh?",
    message: "This permanently clears the previous plan and begins a new day.",
    actionLabel: "Start fresh",
  });
}

function startFreshDay() {
  clearUndoToast();
  state.dateKey = getDateKey();
  state.tasks = [];
  state.expandedTaskId = null;
  state.isAddingInline = false;
  saveTasks();
  render();
  announce("Fresh day started.");
}

function loadTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || !stored.dateKey) return;
    state.dateKey = stored.dateKey;
    state.tasks = Array.isArray(stored.tasks) ? stored.tasks.map(normalizeTask) : [];
  } catch {
    setStorageAvailable(false);
    state.tasks = [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dateKey: state.dateKey,
        tasks: state.tasks,
      })
    );
  } catch {
    setStorageAvailable(false);
    // The app still works in memory if browser storage is unavailable.
  }
}

function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (prefs && typeof prefs === "object") {
      state.prefs = {
        name: typeof prefs.name === "string" ? prefs.name : "",
      };
    }
  } catch {
    setStorageAvailable(false);
    state.prefs = { name: "" };
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
  } catch {
    setStorageAvailable(false);
    // Preferences are optional; storage can fail in restricted browser modes.
  }
}

function handleStorageEvent(event) {
  if (event.key !== STORAGE_KEY && event.key !== PREFS_KEY) return;

  if (isUserEditing()) {
    state.pendingExternalChange = true;
    renderSyncBanner();
    announce("Plan changed in another tab.");
    return;
  }

  applyExternalStorageChanges();
}

function isUserEditing() {
  if (elements.taskModal.open) return true;
  if (state.isAddingInline) return true;
  const active = document.activeElement;
  if (!active) return false;
  if (active === document.body) return false;
  return Boolean(active.closest("input, select, textarea, [contenteditable='true']"));
}

function applyExternalStorageChanges() {
  state.pendingExternalChange = false;
  if (elements.taskModal.open) closeTaskModal();
  clearUndoToast();
  state.isAddingInline = false;
  state.currentBatchTaskIds = [];
  state.batchDraggedTaskId = null;
  loadPrefs();
  loadTasks();
  render();
  announce("Latest plan applied.");
}

function normalizeTask(task) {
  return {
    id: typeof task.id === "string" ? task.id : `task-${Date.now()}`,
    title: typeof task.title === "string" && task.title.trim() ? task.title : "Untitled task",
    status: STATUS_OPTIONS.some((option) => option.value === task.status) ? task.status : "todo",
    startTime: typeof task.startTime === "string" ? task.startTime : "",
    endTime: typeof task.endTime === "string" ? task.endTime : "",
    createdAt: typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString(),
  };
}

function createTaskId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function testStorageAvailability() {
  try {
    const testKey = "planForToday.storageTest";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function setStorageAvailable(isAvailable) {
  state.storageAvailable = isAvailable;
  if (elements.storageWarning) {
    elements.storageWarning.hidden = isAvailable;
  }
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatToday() {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

function formatClock(date = new Date()) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function chooseNextHeadline() {
  const index = getNextHeadlineIndex();
  state.currentHeadline = DAILY_HEADLINES[index];
  saveHeadlineState(index);
}

function getNextHeadlineIndex() {
  const fallbackIndex = Math.floor(Math.random() * DAILY_HEADLINES.length);

  try {
    const stored = JSON.parse(localStorage.getItem(HEADLINE_KEY));
    const previousIndex = Number.isInteger(stored?.index) ? stored.index : null;
    if (previousIndex === null) return fallbackIndex;
    return (previousIndex + 1) % DAILY_HEADLINES.length;
  } catch {
    return fallbackIndex;
  }
}

function saveHeadlineState(index) {
  try {
    localStorage.setItem(
      HEADLINE_KEY,
      JSON.stringify({
        index,
        dateKey: getDateKey(),
      })
    );
  } catch {
    // Headline rotation is cosmetic, so the app can continue without storage.
  }
}

function getDateWithTime(time, dateKey = state.dateKey) {
  const [hours, minutes] = time.split(":").map(Number);
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeDialog(dialog) {
  if (dialog.open && typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}
