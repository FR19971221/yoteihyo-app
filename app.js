/**
 * 東京事務所予定表 Webアプリケーション
 * 
 * 1. Firebase Firestore リアルタイム同期 (マルチデバイス自動更新)
 * 2. 閲覧権限・編集権限の分離 (デフォルト: 閲覧専用 / 管理者ログインで編集解除)
 * 3. 表示スパン切替 (1週間:7日 / 半月:15日 / 月毎:1ヶ月) [PC・スマホ完全統合]
 * 4. 2軸 Sticky スクロール (左側ステータス固定 & 上部日付ヘッダー固定)
 * 5. 「今日へ」ボタンのリアルタイムPC日時 (Today) リンク
 * 6. 複数日タスクの段(レーン)一致・連結帯 (コネクテッドバー) 表示 & 個別日編集の完全両立
 * 7. スマホ向けUI集約 (ハンバーガードロワーメニュー & 右下固定FABボタン)
 * 8. 連続・スムーズな無制限横スクロール表示（ページネーションの廃止）
 */

const STATUS_LIST = [
  "現場",
  "社内勤務",
  "休み",
  "有休",
  "5階泊",
  "ﾎﾃル泊"
];

const INITIAL_MEMBERS = ["M", "R", "Z", "吉", "黒", "佐藤"];

// 初期フォールバック用データ
const INITIAL_DEMO_SCHEDULES = [
  { id: "s1", date: "2026-08-19", status: "現場", title: "【渋谷現場】改修工事・機材搬入", details: "9:00〜17:00 / 渋谷区桜丘町 / トラック2台", members: ["M", "R", "吉"] },
  { id: "s2", date: "2026-08-19", status: "現場", title: "【新宿現場】定期点検・動作テスト", details: "13:00〜18:00 / 担当者立会あり", members: ["Z"] },
  { id: "s3", date: "2026-08-19", status: "社内勤務", title: "社内勤務", details: "終日社内作業 / 来客14:00", members: ["黒"] },
  { id: "s4", date: "2026-08-19", status: "5階泊", title: "5階泊", details: "翌朝点検対応のため", members: ["M"] },
  { id: "s5", date: "2026-08-19", status: "休み", title: "休み", details: "定休日", members: ["佐藤"] },
  { id: "s6", date: "2026-08-20", status: "現場", title: "【品川現場】新設工事 1日目", details: "8:30〜 / 大型機材搬入", members: ["M", "吉", "黒"] },
  { id: "s7", date: "2026-08-20", status: "社内勤務", title: "社内勤務", details: "10:00〜12:00 ミーティング", members: ["R", "Z"] },
  { id: "s8", date: "2026-08-20", status: "ﾎﾃル泊", title: "ﾎﾃル泊", details: "品川駅前宿泊", members: ["吉"] }
];

const STORAGE_KEY = "tokyo_schedules_master_data_v6";
const MEMBERS_STORAGE_KEY = "tokyo_schedules_master_members_v6";
const AUTH_SESSION_KEY = "tokyo_schedule_admin_auth_session";

class ScheduleApp {
  constructor() {
    this.schedules = [];
    this.allMembers = [...INITIAL_MEMBERS];

    // リアルタイムPC現在日時（Today）を基準日に設定
    this.realToday = this.getRealTodayYmd();
    this.currentDate = this.realToday;
    this.currentYearMonth = this.currentDate.substring(0, 7);

    this.selectedMember = "ALL";
    this.searchKeyword = "";

    // 画面幅が768px以下の場合は自動的にスマホ表示に固定
    this.currentView = window.innerWidth <= 768 ? "mobile" : "pc";
    this.mobileSubMode = "day"; // 'day' or 'month'
    this.viewSpan = "week"; // 'week', 'halfmonth', 'month'
    this.isAdmin = false;
    this.activeModalItemId = null;

    this.db = null;
    this.isCloudConnected = false;
    this.unsubscribeFirestore = null;

    // スクロール・スワイプの連続送り制御
    this.isSwipeThrottled = false;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchEndX = 0;
    this.touchEndY = 0;

    this.checkAdminSession();
    this.generateDateRange(this.currentDate);

    this.bindDom();
    this.bindEvents();
    this.initSwipeAndScrollGestures();
    this.initFirebaseAndLoadData();

    // 画面リサイズ時にスマホなら自動的にビューを切り替え
    window.addEventListener("resize", () => {
      if (window.innerWidth <= 768 && this.currentView !== "mobile") {
        this.switchView("mobile");
      }
    });
  }

  getRealTodayYmd() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  checkAdminSession() {
    const savedAuth = sessionStorage.getItem(AUTH_SESSION_KEY);
    this.isAdmin = (savedAuth === "true");
    this.applyAuthModeUI();
  }

  setAdminMode(isAdmin) {
    this.isAdmin = isAdmin;
    sessionStorage.setItem(AUTH_SESSION_KEY, isAdmin ? "true" : "false");
    this.applyAuthModeUI();
    this.render();
  }

  applyAuthModeUI() {
    if (this.isAdmin) {
      document.body.classList.remove("mode-readonly");
      document.body.classList.add("mode-admin");
      if (this.badgeReadOnly) this.badgeReadOnly.style.display = "none";
      if (this.badgeAdminMode) this.badgeAdminMode.style.display = "inline-flex";
      if (this.btnAdminLogin) this.btnAdminLogin.style.display = "none";
      if (this.btnAdminLogout) this.btnAdminLogout.style.display = "inline-flex";
    } else {
      document.body.classList.add("mode-readonly");
      document.body.classList.remove("mode-admin");
      if (this.badgeReadOnly) this.badgeReadOnly.style.display = "inline-flex";
      if (this.badgeAdminMode) this.badgeAdminMode.style.display = "none";
      if (this.btnAdminLogin) this.btnAdminLogin.style.display = "inline-flex";
      if (this.btnAdminLogout) this.btnAdminLogout.style.display = "none";
    }
  }

  // ================= 横スクロールでなめらかに繋がる広範囲の日付生成 =================
  generateDateRange(centerDateStr) {
    const [y, m, d] = centerDateStr.split('-').map(Number);
    const center = new Date(y, m - 1, d);
    const range = [];

    // 一気に画面が変わるのを防ぎ、前後を含めた連続表示を可能にするため広い範囲を生成
    let pastDays = 14;
    let futureDays = 30;

    if (this.viewSpan === "halfmonth") {
      pastDays = 20;
      futureDays = 40;
    } else if (this.viewSpan === "month") {
      pastDays = 30;
      futureDays = 60;
    }

    for (let i = -pastDays; i <= futureDays; i++) {
      const target = new Date(center);
      target.setDate(target.getDate() + i);
      range.push(this.formatYmd(target));
    }

    this.dateRange = range;
    this.currentYearMonth = `${center.getFullYear()}-${String(center.getMonth() + 1).padStart(2, '0')}`;
  }

  formatYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  addDaysToDateStr(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return this.formatYmd(dt);
  }

  normalizeStatus(st) {
    if (!st) return "現場";
    st = String(st).trim();
    if (st.includes("現場")) return "現場";
    if (st.includes("社内")) return "社内勤務";
    if (st.includes("有休") || st.includes("有給")) return "有休";
    if (st.includes("休")) return "休み";
    if (st.includes("5階") || st.includes("５階")) return "5階泊";
    if (st.includes("ホテル") || st.includes("ﾎﾃル") || st.includes("宿泊") || st.includes("泊")) return "ﾎﾃル泊";
    return "現場";
  }

  bindDom() {
    this.btnPcView = document.getElementById("btnPcView");
    this.btnMobileView = document.getElementById("btnMobileView");
    this.pcSection = document.getElementById("pcMatrixSection");
    this.mobileSection = document.getElementById("mobileDailySection");

    // Header Controls
    this.prevDateBtn = document.getElementById("prevDateBtn");
    this.nextDateBtn = document.getElementById("nextDateBtn");
    this.todayBtn = document.getElementById("todayBtn");
    this.dateDisplayBtn = document.getElementById("dateDisplayBtn");
    this.hiddenDatePicker = document.getElementById("hiddenDatePicker");
    this.currentDateDisplay = document.getElementById("currentDateDisplay");

    // Auth & Sync DOM
    this.badgeReadOnly = document.getElementById("badgeReadOnly");
    this.badgeAdminMode = document.getElementById("badgeAdminMode");
    this.syncIndicator = document.getElementById("syncIndicator");
    this.btnAdminLogin = document.getElementById("btnAdminLogin");
    this.btnAdminLogout = document.getElementById("btnAdminLogout");
    this.adminLoginModal = document.getElementById("adminLoginModal");
    this.adminLoginForm = document.getElementById("adminLoginForm");
    this.adminPasswordInput = document.getElementById("adminPasswordInput");
    this.adminLoginError = document.getElementById("adminLoginError");
    this.adminLoginCloseBtn = document.getElementById("adminLoginCloseBtn");
    this.btnCancelAdminLogin = document.getElementById("btnCancelAdminLogin");

    // Action Tools & FAB
    this.btnNewSchedule = document.getElementById("btnNewSchedule");
    this.floatingAddBtn = document.getElementById("floatingAddBtn");
    this.btnBatchActions = document.getElementById("btnBatchActions");
    this.btnManageMembers = document.getElementById("btnManageMembers");
    this.btnExportData = document.getElementById("btnExportData");
    this.btnImportData = document.getElementById("btnImportData");
    this.fileImportInput = document.getElementById("fileImportInput");

    // Mobile Hamburger & Drawer DOM
    this.btnHamburgerMenu = document.getElementById("btnHamburgerMenu");
    this.mobileNavDrawer = document.getElementById("mobileNavDrawer");
    this.mobileDrawerOverlay = document.getElementById("mobileDrawerOverlay");
    this.btnDrawerClose = document.getElementById("btnDrawerClose");
    this.drawerBtnNewSchedule = document.getElementById("drawerBtnNewSchedule");
    this.drawerBtnBatchActions = document.getElementById("drawerBtnBatchActions");
    this.drawerBtnManageMembers = document.getElementById("drawerBtnManageMembers");
    this.drawerBtnExportData = document.getElementById("drawerBtnExportData");
    this.drawerBtnImportData = document.getElementById("drawerBtnImportData");

    // Ribbon Controls (Span & Filter)
    this.spanTabs = document.querySelectorAll(".span-tab");
    this.memberFilterList = document.getElementById("memberFilterList");
    this.searchInput = document.getElementById("searchInput");
    this.searchClearBtn = document.getElementById("searchClearBtn");

    this.matrixTableContainer = document.getElementById("matrixTableContainer");
    this.matrixScrollWrapper = document.getElementById("matrixScrollWrapper");

    // Mobile View DOM
    this.mobileTouchArea = document.getElementById("mobileTouchArea");
    this.mobileSubViewDay = document.getElementById("mobileSubViewDay");
    this.mobileSubViewMonth = document.getElementById("mobileSubViewMonth");
    this.mobileHeaderBadge = document.getElementById("mobileHeaderBadge");
    this.mobileMonthNav = document.getElementById("mobileMonthNav");
    this.mobileMonthLabel = document.getElementById("mobileMonthLabel");
    this.mobilePrevMonthBtn = document.getElementById("mobilePrevMonthBtn");
    this.mobileNextMonthBtn = document.getElementById("mobileNextMonthBtn");
    this.mobileDateHero = document.getElementById("mobileDateHero");

    this.mobileDateStrip = document.getElementById("mobileDateStrip");
    this.mobileCardsContainer = document.getElementById("mobileCardsContainer");
    this.mobileMonthCalendarGrid = document.getElementById("mobileMonthCalendarGrid");
    this.mobileMonthAgendaList = document.getElementById("mobileMonthAgendaList");
    this.mobileAgendaTitle = document.getElementById("mobileAgendaTitle");
    this.mobileAgendaCount = document.getElementById("mobileAgendaCount");

    // Detail Modal
    this.detailModal = document.getElementById("scheduleModal");
    this.modalCloseBtn = document.getElementById("modalCloseBtn");
    this.modalEditBtn = document.getElementById("modalEditBtn");
    this.modalTitle = document.getElementById("modalTitle");
    this.modalStatusPill = document.getElementById("modalStatusPill");
    this.modalDate = document.getElementById("modalDate");
    this.modalMembers = document.getElementById("modalMembers");
    this.modalDetails = document.getElementById("modalDetails");

    // Edit/Create Modal
    this.editModal = document.getElementById("editModal");
    this.editModalCloseBtn = document.getElementById("editModalCloseBtn");
    this.btnCancelEdit = document.getElementById("btnCancelEdit");
    this.scheduleEditForm = document.getElementById("scheduleEditForm");
    this.editModalHeaderTitle = document.getElementById("editModalHeaderTitle");
    this.btnDeleteSchedule = document.getElementById("btnDeleteSchedule");

    this.editItemId = document.getElementById("editItemId");
    this.formTitle = document.getElementById("formTitle");
    this.formDate = document.getElementById("formDate");
    this.formStatus = document.getElementById("formStatus");
    this.formDetails = document.getElementById("formDetails");
    this.formMemberSelector = document.getElementById("formMemberSelector");

    this.chkBatchRange = document.getElementById("chkBatchRange");
    this.batchDatesInputs = document.getElementById("batchDatesInputs");
    this.formEndDate = document.getElementById("formEndDate");
    this.batchRangeBox = document.getElementById("batchRangeBox");

    this.customMemberInput = document.getElementById("customMemberInput");
    this.btnAddCustomMember = document.getElementById("btnAddCustomMember");
    this.btnOpenMemberManagerFromForm = document.getElementById("btnOpenMemberManagerFromForm");

    // Member Manager Modal
    this.memberManagerModal = document.getElementById("memberManagerModal");
    this.memberManagerCloseBtn = document.getElementById("memberManagerCloseBtn");
    this.newMemberInputModal = document.getElementById("newMemberInputModal");
    this.btnAddNewMemberModal = document.getElementById("btnAddNewMemberModal");
    this.memberManagerTableBody = document.getElementById("memberManagerTableBody");

    // Batch Modal
    this.batchModal = document.getElementById("batchModal");
    this.batchModalCloseBtn = document.getElementById("batchModalCloseBtn");
    this.bulkAddForm = document.getElementById("bulkAddForm");
    this.bulkDeleteForm = document.getElementById("bulkDeleteForm");
    this.bulkStartDate = document.getElementById("bulkStartDate");
    this.bulkEndDate = document.getElementById("bulkEndDate");
    this.bulkStatus = document.getElementById("bulkStatus");
    this.bulkTitle = document.getElementById("bulkTitle");
    this.bulkDetails = document.getElementById("bulkDetails");
    this.bulkMemberSelector = document.getElementById("bulkMemberSelector");

    this.deleteStartDate = document.getElementById("deleteStartDate");
    this.deleteEndDate = document.getElementById("deleteEndDate");
    this.deleteStatusFilter = document.getElementById("deleteStatusFilter");
    this.deleteMemberFilter = document.getElementById("deleteMemberFilter");
  }

  bindEvents() {
    if (this.btnPcView) this.btnPcView.addEventListener("click", () => this.switchView("pc"));
    if (this.btnMobileView) this.btnMobileView.addEventListener("click", () => this.switchView("mobile"));

    // 期間スパン切り替えタブ
    this.spanTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const span = tab.dataset.span;
        this.switchSpan(span);
      });
    });

    // Mobile Drawer Open / Close
    if (this.btnHamburgerMenu) this.btnHamburgerMenu.addEventListener("click", () => this.openMobileDrawer());
    if (this.btnDrawerClose) this.btnDrawerClose.addEventListener("click", () => this.closeMobileDrawer());
    if (this.mobileDrawerOverlay) this.mobileDrawerOverlay.addEventListener("click", () => this.closeMobileDrawer());

    // Drawer Menu Items
    if (this.drawerBtnNewSchedule) {
      this.drawerBtnNewSchedule.addEventListener("click", () => {
        this.closeMobileDrawer();
        if (this.isAdmin) this.openCreateModal(this.currentDate, "現場");
      });
    }
    if (this.drawerBtnBatchActions) {
      this.drawerBtnBatchActions.addEventListener("click", () => {
        this.closeMobileDrawer();
        if (this.isAdmin) this.openBatchModal();
      });
    }
    if (this.drawerBtnManageMembers) {
      this.drawerBtnManageMembers.addEventListener("click", () => {
        this.closeMobileDrawer();
        if (this.isAdmin) this.openMemberManagerModal();
      });
    }
    if (this.drawerBtnExportData) {
      this.drawerBtnExportData.addEventListener("click", () => {
        this.closeMobileDrawer();
        this.exportDataToFile();
      });
    }
    if (this.drawerBtnImportData) {
      this.drawerBtnImportData.addEventListener("click", () => {
        this.closeMobileDrawer();
        this.fileImportInput.click();
      });
    }

    // Floating Action Button (FAB)
    if (this.floatingAddBtn) {
      this.floatingAddBtn.addEventListener("click", () => {
        if (this.isAdmin) this.openCreateModal(this.currentDate, "現場");
      });
    }

    // Admin Auth Actions
    if (this.btnAdminLogin) this.btnAdminLogin.addEventListener("click", () => this.openAdminLoginModal());
    if (this.btnAdminLogout) {
      this.btnAdminLogout.addEventListener("click", () => {
        if (confirm("閲覧専用モードに戻りますか？")) {
          this.setAdminMode(false);
        }
      });
    }

    if (this.adminLoginCloseBtn) this.adminLoginCloseBtn.addEventListener("click", () => this.closeAdminLoginModal());
    if (this.btnCancelAdminLogin) this.btnCancelAdminLogin.addEventListener("click", () => this.closeAdminLoginModal());
    if (this.adminLoginModal) {
      this.adminLoginModal.addEventListener("click", (e) => {
        if (e.target === this.adminLoginModal) this.closeAdminLoginModal();
      });
    }

    if (this.adminLoginForm) {
      this.adminLoginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const inputPass = this.adminPasswordInput.value;
        const targetPass = (window.ADMIN_PASSWORD !== undefined) ? window.ADMIN_PASSWORD : "admin";
        if (inputPass === targetPass) {
          this.closeAdminLoginModal();
          this.setAdminMode(true);
          alert("🔓 管理者認証に成功しました！編集モードがアンロックされました。");
        } else {
          this.adminLoginError.style.display = "block";
        }
      });
    }

    if (this.mobilePrevMonthBtn) this.mobilePrevMonthBtn.addEventListener("click", () => this.stepMonth(-1));
    if (this.mobileNextMonthBtn) this.mobileNextMonthBtn.addEventListener("click", () => this.stepMonth(1));

    // 「今日へ」ボタン
    if (this.todayBtn) {
      this.todayBtn.addEventListener("click", () => {
        this.realToday = this.getRealTodayYmd();
        this.currentDate = this.realToday;
        this.generateDateRange(this.currentDate);
        this.updateHeaderDates();
        this.render();
        this.scrollToCurrentDate();
      });
    }

    // 日付移動ボタン
    if (this.prevDateBtn) this.prevDateBtn.addEventListener("click", () => this.stepDateBySpan(-1));
    if (this.nextDateBtn) this.nextDateBtn.addEventListener("click", () => this.stepDateBySpan(1));

    if (this.dateDisplayBtn) {
      this.dateDisplayBtn.addEventListener("click", () => {
        this.hiddenDatePicker.showPicker ? this.hiddenDatePicker.showPicker() : this.hiddenDatePicker.click();
      });
    }

    if (this.hiddenDatePicker) {
      this.hiddenDatePicker.addEventListener("change", (e) => {
        if (e.target.value) {
          this.currentDate = e.target.value;
          this.generateDateRange(this.currentDate);
          this.updateHeaderDates();
          this.render();
          this.scrollToCurrentDate();
        }
      });
    }

    if (this.memberFilterList) {
      this.memberFilterList.addEventListener("click", (e) => {
        const pill = e.target.closest(".member-pill");
        if (!pill) return;
        document.querySelectorAll(".member-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        this.selectedMember = pill.dataset.member;
        this.render();
      });
    }

    if (this.searchInput) {
      this.searchInput.addEventListener("input", (e) => {
        this.searchKeyword = e.target.value.toLowerCase().trim();
        this.searchClearBtn.style.display = this.searchKeyword ? "block" : "none";
        this.render();
      });
    }

    if (this.searchClearBtn) {
      this.searchClearBtn.addEventListener("click", () => {
        this.searchInput.value = "";
        this.searchKeyword = "";
        this.searchClearBtn.style.display = "none";
        this.render();
      });
    }

    if (this.btnNewSchedule) {
      this.btnNewSchedule.addEventListener("click", () => {
        if (!this.isAdmin) return;
        this.openCreateModal(this.currentDate, "現場");
      });
    }

    if (this.btnExportData) this.btnExportData.addEventListener("click", () => this.exportDataToFile());
    if (this.btnImportData) this.btnImportData.addEventListener("click", () => this.fileImportInput.click());
    if (this.fileImportInput) this.fileImportInput.addEventListener("change", (e) => this.handleFileImport(e));

    if (this.btnManageMembers) this.btnManageMembers.addEventListener("click", () => this.openMemberManagerModal());
    if (this.btnOpenMemberManagerFromForm) {
      this.btnOpenMemberManagerFromForm.addEventListener("click", () => {
        this.closeEditModal();
        this.openMemberManagerModal();
      });
    }
    if (this.memberManagerCloseBtn) this.memberManagerCloseBtn.addEventListener("click", () => this.closeMemberManagerModal());
    if (this.memberManagerModal) {
      this.memberManagerModal.addEventListener("click", (e) => {
        if (e.target === this.memberManagerModal) this.closeMemberManagerModal();
      });
    }

    if (this.btnAddNewMemberModal) this.btnAddNewMemberModal.addEventListener("click", () => this.addMemberFromModal());
    if (this.newMemberInputModal) {
      this.newMemberInputModal.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.addMemberFromModal();
        }
      });
    }

    if (this.btnBatchActions) this.btnBatchActions.addEventListener("click", () => this.openBatchModal());
    if (this.batchModalCloseBtn) this.batchModalCloseBtn.addEventListener("click", () => this.closeBatchModal());
    if (this.batchModal) {
      this.batchModal.addEventListener("click", (e) => {
        if (e.target === this.batchModal) this.closeBatchModal();
      });
    }

    document.querySelectorAll(".batch-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".batch-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".batch-tab-content").forEach(c => c.classList.remove("active"));
        tab.classList.add("active");
        const targetId = tab.dataset.tab === "bulk-add" ? "tabBulkAdd" : "tabBulkDelete";
        document.getElementById(targetId).classList.add("active");
      });
    });

    if (this.modalCloseBtn) this.modalCloseBtn.addEventListener("click", () => this.closeDetailModal());
    if (this.detailModal) {
      this.detailModal.addEventListener("click", (e) => {
        if (e.target === this.detailModal) this.closeDetailModal();
      });
    }

    if (this.modalEditBtn) {
      this.modalEditBtn.addEventListener("click", () => {
        if (this.activeModalItemId) {
          if (!this.isAdmin) {
            alert("編集するには管理者ログインが必要です。");
            return;
          }
          this.closeDetailModal();
          this.openEditModal(this.activeModalItemId);
        }
      });
    }

    if (this.editModalCloseBtn) this.editModalCloseBtn.addEventListener("click", () => this.closeEditModal());
    if (this.btnCancelEdit) this.btnCancelEdit.addEventListener("click", () => this.closeEditModal());
    if (this.editModal) {
      this.editModal.addEventListener("click", (e) => {
        if (e.target === this.editModal) this.closeEditModal();
      });
    }

    if (this.btnAddCustomMember) this.btnAddCustomMember.addEventListener("click", () => this.addCustomMemberFromInput());
    if (this.customMemberInput) {
      this.customMemberInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.addCustomMemberFromInput();
        }
      });
    }

    if (this.formStatus) {
      this.formStatus.addEventListener("change", () => {
        this.adjustFormForStatus(this.formStatus.value);
      });
    }

    if (this.chkBatchRange) {
      this.chkBatchRange.addEventListener("change", () => {
        this.batchDatesInputs.style.display = this.chkBatchRange.checked ? "flex" : "none";
        if (this.chkBatchRange.checked && !this.formEndDate.value) {
          this.formEndDate.value = this.formDate.value;
        }
      });
    }

    if (this.scheduleEditForm) {
      this.scheduleEditForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.saveScheduleForm();
      });
    }

    if (this.btnDeleteSchedule) {
      this.btnDeleteSchedule.addEventListener("click", () => {
        const id = this.editItemId.value;
        if (id && confirm("この予定を削除してもよろしいですか？")) {
          this.deleteSchedule(id);
          this.closeEditModal();
        }
      });
    }

    if (this.bulkAddForm) {
      this.bulkAddForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleBulkAdd();
      });
    }

    if (this.bulkDeleteForm) {
      this.bulkDeleteForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleBulkDelete();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeDetailModal();
        this.closeEditModal();
        this.closeMemberManagerModal();
        this.closeBatchModal();
        this.closeAdminLoginModal();
        this.closeMobileDrawer();
      }
    });
  }

  // ================= スワイプ & 自然な横スクロール制御 =================
  initSwipeAndScrollGestures() {
    const touchTarget = this.mobileTouchArea || document.body;

    touchTarget.addEventListener('touchstart', (e) => {
      this.touchStartX = e.changedTouches[0].screenX;
      this.touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    touchTarget.addEventListener('touchend', (e) => {
      this.touchEndX = e.changedTouches[0].screenX;
      this.touchEndY = e.changedTouches[0].screenY;
      this.handleSwipeGesture();
    }, { passive: true });
  }

  handleSwipeGesture() {
    const diffX = this.touchEndX - this.touchStartX;
    const diffY = this.touchEndY - this.touchStartY;

    if (Math.abs(diffX) > Math.abs(diffY) * 1.4 && Math.abs(diffX) > 50) {
      if (this.isSwipeThrottled) return;
      this.isSwipeThrottled = true;

      const container = this.mobileCardsContainer || this.mobileSubViewMonth;
      if (diffX < 0) {
        if (container) {
          container.classList.remove('swipe-anim-left', 'swipe-anim-right');
          void container.offsetWidth;
          container.classList.add('swipe-anim-left');
        }
        this.stepDateBySpan(1);
      } else {
        if (container) {
          container.classList.remove('swipe-anim-left', 'swipe-anim-right');
          void container.offsetWidth;
          container.classList.add('swipe-anim-right');
        }
        this.stepDateBySpan(-1);
      }

      setTimeout(() => {
        this.isSwipeThrottled = false;
      }, 400);
    }
  }

  // 選択した日付へスムーズにスクロール移動
  scrollToCurrentDate() {
    if (!this.matrixScrollWrapper) return;
    const targetTh = this.matrixTableContainer.querySelector(`th.selected-col, th.today-col`);
    if (targetTh) {
      const scrollLeft = targetTh.offsetLeft - 150;
      this.matrixScrollWrapper.scrollTo({
        left: scrollLeft,
        behavior: 'smooth'
      });
    }
  }

  openMobileDrawer() {
    this.mobileNavDrawer.classList.add("active");
    this.mobileDrawerOverlay.classList.add("active");
  }

  closeMobileDrawer() {
    this.mobileNavDrawer.classList.remove("active");
    this.mobileDrawerOverlay.classList.remove("active");
  }

  switchSpan(span) {
    this.spanTabs.forEach(t => t.classList.toggle("active", t.dataset.span === span));
    this.viewSpan = span;

    if (span === "month") {
      this.mobileSubMode = "month";
      if (this.mobileSubViewDay) this.mobileSubViewDay.classList.remove("active");
      if (this.mobileSubViewMonth) this.mobileSubViewMonth.classList.add("active");
      if (this.mobileHeaderBadge) this.mobileHeaderBadge.style.display = "none";
      if (this.mobileMonthNav) this.mobileMonthNav.style.display = "flex";
    } else {
      this.mobileSubMode = "day";
      if (this.mobileSubViewDay) this.mobileSubViewDay.classList.add("active");
      if (this.mobileSubViewMonth) this.mobileSubViewMonth.classList.remove("active");
      if (this.mobileHeaderBadge) this.mobileHeaderBadge.style.display = "inline-block";
      if (this.mobileMonthNav) this.mobileMonthNav.style.display = "none";
    }

    this.generateDateRange(this.currentDate);
    this.updateHeaderDates();
    this.render();
  }

  openAdminLoginModal() {
    this.adminPasswordInput.value = "";
    this.adminLoginError.style.display = "none";
    this.adminLoginModal.classList.add("active");
    this.adminLoginModal.setAttribute("aria-hidden", "false");
    setTimeout(() => this.adminPasswordInput.focus(), 100);
  }

  closeAdminLoginModal() {
    this.adminLoginModal.classList.remove("active");
    this.adminLoginModal.setAttribute("aria-hidden", "true");
  }

  stepDateBySpan(direction) {
    const [y, m, d] = this.currentDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);

    if (this.viewSpan === "week") {
      dt.setDate(dt.getDate() + (direction * 7));
    } else if (this.viewSpan === "halfmonth") {
      dt.setDate(dt.getDate() + (direction * 15));
    } else if (this.viewSpan === "month") {
      dt.setMonth(dt.getMonth() + direction);
    }
    this.currentDate = this.formatYmd(dt);
    this.generateDateRange(this.currentDate);
    this.updateHeaderDates();
    this.render();
    this.scrollToCurrentDate();
  }

  async initFirebaseAndLoadData() {
    let firebaseReady = false;
    if (window.firebase && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && window.FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY") {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(window.FIREBASE_CONFIG);
        }
        this.db = firebase.firestore();
        this.isCloudConnected = true;
        firebaseReady = true;

        if (this.syncIndicator) {
          this.syncIndicator.textContent = "🟢 クラウド同期中";
          this.syncIndicator.className = "sync-indicator";
        }

        this.db.collection("metadata").doc("members").onSnapshot(doc => {
          if (doc.exists && Array.isArray(doc.data().list)) {
            this.allMembers = Array.from(new Set([...INITIAL_MEMBERS, ...doc.data().list]));
            this.renderMemberFilterBar();
          }
        });

        this.unsubscribeFirestore = this.db.collection("schedules").onSnapshot(snapshot => {
          const cloudItems = [];
          snapshot.forEach(doc => {
            cloudItems.push({ id: doc.id, ...doc.data() });
          });

          this.schedules = cloudItems.map(s => ({
            ...s,
            status: this.normalizeStatus(s.status)
          }));

          this.collectMembersFromSchedules();
          this.renderMemberFilterBar();
          this.render();
        }, err => {
          console.warn("Firestore onSnapshot error:", err);
        });

      } catch (e) {
        console.warn("Firebase初期化失敗。LocalStorageフォールバックを使用します。", e);
      }
    }

    if (!firebaseReady) {
      if (this.syncIndicator) {
        this.syncIndicator.textContent = "🟡 ローカルモード (Firebase未設定)";
        this.syncIndicator.className = "sync-indicator sync-local";
      }
      this.loadLocalData();
    }
  }

  async loadLocalData() {
    const savedMembers = localStorage.getItem(MEMBERS_STORAGE_KEY);
    if (savedMembers) {
      try {
        const parsedM = JSON.parse(savedMembers);
        if (Array.isArray(parsedM)) {
          this.allMembers = Array.from(new Set([...INITIAL_MEMBERS, ...parsedM]));
        }
      } catch (e) { }
    }

    const local = localStorage.getItem(STORAGE_KEY);
    if (local !== null) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed)) {
          this.schedules = parsed.map(s => ({
            ...s,
            status: this.normalizeStatus(s.status)
          }));
          this.collectMembersFromSchedules();
          this.renderMemberFilterBar();
          this.updateHeaderDates();
          this.render();
          return;
        }
      } catch (e) { }
    }

    try {
      const res = await fetch("schedules.json");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          this.schedules = data.map(s => ({
            ...s,
            status: this.normalizeStatus(s.status)
          }));
        } else {
          this.schedules = [];
        }
      } else {
        this.schedules = INITIAL_DEMO_SCHEDULES;
      }
    } catch (err) {
      this.schedules = [];
    }

    this.collectMembersFromSchedules();
    this.saveToStorage();
    this.saveMembersToStorage();
    this.renderMemberFilterBar();
    this.updateHeaderDates();
    this.render();
  }

  async saveScheduleItem(item) {
    if (this.isCloudConnected && this.db) {
      try {
        const cleanItem = {
          title: item.title || "",
          date: item.date,
          status: item.status,
          details: item.details || "",
          members: item.members || [],
          isEmptySlot: false,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await this.db.collection("schedules").doc(item.id).set(cleanItem, { merge: true });
        return;
      } catch (e) {
        console.error("Firestore保存エラー:", e);
      }
    }

    const idx = this.schedules.findIndex(s => s.id === item.id);
    if (idx !== -1) {
      this.schedules[idx] = item;
    } else {
      this.schedules.push(item);
    }
    this.saveToStorage();
    this.render();
  }

  async deleteScheduleItem(id) {
    if (this.isCloudConnected && this.db) {
      try {
        await this.db.collection("schedules").doc(id).delete();
        return;
      } catch (e) {
        console.error("Firestore削除エラー:", e);
      }
    }

    this.schedules = this.schedules.filter(s => s.id !== id);
    this.saveToStorage();
    this.render();
  }

  async saveMembersList() {
    if (this.isCloudConnected && this.db) {
      try {
        await this.db.collection("metadata").doc("members").set({
          list: this.allMembers,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {
        console.error("Firestoreメンバー保存エラー:", e);
      }
    }
    this.saveMembersToStorage();
  }

  saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.schedules));
    } catch (e) { }
  }

  saveMembersToStorage() {
    try {
      localStorage.setItem(MEMBERS_STORAGE_KEY, JSON.stringify(this.allMembers));
    } catch (e) { }
  }

  collectMembersFromSchedules() {
    this.schedules.forEach(s => {
      if (s.members && Array.isArray(s.members)) {
        s.members.forEach(m => {
          if (m && !this.allMembers.includes(m)) {
            this.allMembers.push(m);
          }
        });
      }
    });
  }

  async handleBulkAdd() {
    const startStr = this.bulkStartDate.value;
    const endStr = this.bulkEndDate.value;
    const status = this.normalizeStatus(this.bulkStatus.value);
    let title = this.bulkTitle.value.trim();
    const details = this.bulkDetails.value.trim();

    if (!startStr || !endStr) {
      alert("開始日と終了日を指定してください。");
      return;
    }
    if (new Date(startStr) > new Date(endStr)) {
      alert("終了日は開始日以降の日付を指定してください。");
      return;
    }

    if (status === "現場" && !title) {
      alert("現場の場合は案件名を入力してください。");
      return;
    }
    if (!title) {
      title = status;
    }

    const selectedMembers = [];
    this.bulkMemberSelector.querySelectorAll("input[name='bulkMember']:checked").forEach(cb => {
      selectedMembers.push(cb.value);
    });

    const dates = this.getDateRangeArray(startStr, endStr);

    if (this.isCloudConnected && this.db) {
      const batch = this.db.batch();
      dates.forEach(d => {
        const docRef = this.db.collection("schedules").doc();
        batch.set(docRef, {
          title,
          date: d,
          status,
          details,
          members: selectedMembers,
          isEmptySlot: false,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
    } else {
      dates.forEach(d => {
        const newId = "sch_bulk_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
        this.schedules.push({
          id: newId,
          title,
          date: d,
          status,
          details,
          members: selectedMembers,
          isEmptySlot: false
        });
      });
      this.saveToStorage();
      this.render();
    }

    this.closeBatchModal();
    alert(`${dates.length}日分の予定を一括追加しました！`);
  }

  async handleBulkDelete() {
    const startStr = this.deleteStartDate.value;
    const endStr = this.deleteEndDate.value;
    const statusFilter = this.deleteStatusFilter.value;
    const memberFilter = this.deleteMemberFilter.value;

    if (!startStr || !endStr) {
      alert("開始日と終了日を指定してください。");
      return;
    }
    if (new Date(startStr) > new Date(endStr)) {
      alert("終了日は開始日以降の日付を指定してください。");
      return;
    }

    const targetItems = this.schedules.filter(s => {
      if (!s.date) return false;
      const isDateInRange = (s.date >= startStr && s.date <= endStr);
      if (!isDateInRange) return false;

      if (statusFilter !== "ALL") {
        if (this.normalizeStatus(s.status) !== statusFilter) return false;
      }
      if (memberFilter !== "ALL") {
        if (!s.members || !s.members.includes(memberFilter)) return false;
      }
      return true;
    });

    if (targetItems.length === 0) {
      alert("条件に一致する予定が見つかりませんでした。");
      return;
    }

    if (!confirm(`条件に合致する ${targetItems.length} 件の予定を一括削除しますか？`)) {
      return;
    }

    if (this.isCloudConnected && this.db) {
      const batch = this.db.batch();
      targetItems.forEach(item => {
        batch.delete(this.db.collection("schedules").doc(item.id));
      });
      await batch.commit();
    } else {
      const targetIds = new Set(targetItems.map(i => i.id));
      this.schedules = this.schedules.filter(s => !targetIds.has(s.id));
      this.saveToStorage();
      this.render();
    }

    this.closeBatchModal();
    alert(`${targetItems.length}件の予定を一括削除しました。`);
  }

  getDateRangeArray(startDateStr, endDateStr) {
    const dates = [];
    const [sy, sm, sd] = startDateStr.split('-').map(Number);
    const [ey, em, ed] = endDateStr.split('-').map(Number);
    let curr = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    while (curr <= end) {
      dates.push(this.formatYmd(curr));
      curr.setDate(curr.getDate() + 1);
    }
    return dates;
  }

  async saveScheduleForm() {
    const id = this.editItemId.value || ("sch_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4));
    let title = this.formTitle.value.trim();
    const date = this.formDate.value;
    const status = this.normalizeStatus(this.formStatus.value);
    const details = this.formDetails.value.trim();
    const selectedMembers = this.getSelectedFormMembers();

    if (!title && status !== "現場") {
      title = status;
    }
    if (status === "現場" && !title) {
      alert("現場の案件名・現場名を入力してください。");
      return;
    }
    if (!date) {
      alert("日付を入力してください。");
      return;
    }

    if (!this.editItemId.value && this.chkBatchRange.checked && this.formEndDate.value) {
      const endStr = this.formEndDate.value;
      if (new Date(date) > new Date(endStr)) {
        alert("終了日は開始日以降の日付を指定してください。");
        return;
      }
      const dates = this.getDateRangeArray(date, endStr);
      if (this.isCloudConnected && this.db) {
        const batch = this.db.batch();
        dates.forEach(d => {
          const docRef = this.db.collection("schedules").doc();
          batch.set(docRef, {
            title,
            date: d,
            status,
            details,
            members: selectedMembers,
            isEmptySlot: false,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
      } else {
        dates.forEach(d => {
          const newId = "sch_custom_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
          this.schedules.push({
            id: newId,
            title,
            date: d,
            status,
            details,
            members: selectedMembers,
            isEmptySlot: false
          });
        });
        this.saveToStorage();
      }
    } else {
      const item = {
        id,
        title,
        date,
        status,
        details,
        members: selectedMembers,
        isEmptySlot: false
      };
      await this.saveScheduleItem(item);
    }

    if (!this.dateRange.includes(date)) {
      this.currentDate = date;
      this.generateDateRange(date);
      this.updateHeaderDates();
    }

    this.closeEditModal();
    this.render();
  }

  async deleteSchedule(id) {
    await this.deleteScheduleItem(id);
  }

  openMemberManagerModal() {
    this.renderMemberManagerTable();
    this.newMemberInputModal.value = "";
    this.memberManagerModal.classList.add("active");
    this.memberManagerModal.setAttribute("aria-hidden", "false");
  }

  closeMemberManagerModal() {
    this.memberManagerModal.classList.remove("active");
    this.memberManagerModal.setAttribute("aria-hidden", "true");
  }

  renderMemberManagerTable() {
    let html = "";
    this.allMembers.forEach((m, idx) => {
      html += `
        <tr>
          <td><span class="member-chip-lg">${this.escapeHtml(m)}</span></td>
          <td>
            <input type="text" class="member-inline-input" id="member_input_${idx}" value="${this.escapeHtml(m)}" maxlength="10" />
          </td>
          <td style="text-align: center;">
            <div class="member-row-actions">
              <button type="button" class="btn-table-sm btn-rename" onclick="window.app.renameMember('${this.escapeHtml(m)}', ${idx})">✏️ 変更</button>
              <button type="button" class="btn-table-sm btn-row-del" onclick="window.app.removeMember('${this.escapeHtml(m)}')">🗑️ 削除</button>
            </div>
          </td>
        </tr>
      `;
    });
    this.memberManagerTableBody.innerHTML = html;
  }

  addMemberFromModal() {
    const name = this.newMemberInputModal.value.trim();
    if (!name) return;
    if (this.allMembers.includes(name)) {
      alert(`「${name}」は既に登録されています。`);
      return;
    }
    this.allMembers.push(name);
    this.newMemberInputModal.value = "";
    this.saveMembersList();
    this.renderMemberManagerTable();
    this.renderMemberFilterBar();
  }

  async renameMember(oldName, inputIdx) {
    const input = document.getElementById(`member_input_${inputIdx}`);
    const newName = input ? input.value.trim() : "";
    if (!newName) {
      alert("メンバー名を入力してください。");
      return;
    }
    if (newName === oldName) return;

    if (this.allMembers.includes(newName)) {
      alert(`「${newName}」は既に存在します。別の名前を指定してください。`);
      return;
    }

    if (confirm(`メンバー名「${oldName}」を「${newName}」に変更しますか？\n（登録済みの全予定内の担当者名も自動更新されます）`)) {
      const idx = this.allMembers.indexOf(oldName);
      if (idx !== -1) {
        this.allMembers[idx] = newName;
      }

      if (this.selectedMember === oldName) {
        this.selectedMember = newName;
      }

      this.saveMembersList();

      if (this.isCloudConnected && this.db) {
        const batch = this.db.batch();
        this.schedules.forEach(s => {
          if (s.members && Array.isArray(s.members) && s.members.includes(oldName)) {
            const updatedMembers = s.members.map(m => m === oldName ? newName : m);
            batch.update(this.db.collection("schedules").doc(s.id), { members: updatedMembers });
          }
        });
        await batch.commit();
      } else {
        this.schedules.forEach(s => {
          if (s.members && Array.isArray(s.members) && s.members.includes(oldName)) {
            s.members = s.members.map(m => m === oldName ? newName : m);
          }
        });
        this.saveToStorage();
        this.render();
      }

      this.renderMemberManagerTable();
      this.renderMemberFilterBar();
      alert(`「${oldName}」を「${newName}」に変更しました。`);
    }
  }

  async removeMember(targetName) {
    if (confirm(`メンバー「${targetName}」を削除しますか？\n（予定内の担当者設定からも除外されます）`)) {
      this.allMembers = this.allMembers.filter(m => m !== targetName);
      if (this.selectedMember === targetName) {
        this.selectedMember = "ALL";
      }

      this.saveMembersList();

      if (this.isCloudConnected && this.db) {
        const batch = this.db.batch();
        this.schedules.forEach(s => {
          if (s.members && Array.isArray(s.members) && s.members.includes(targetName)) {
            const updatedMembers = s.members.filter(m => m !== targetName);
            batch.update(this.db.collection("schedules").doc(s.id), { members: updatedMembers });
          }
        });
        await batch.commit();
      } else {
        this.schedules.forEach(s => {
          if (s.members && Array.isArray(s.members)) {
            s.members = s.members.filter(m => m !== targetName);
          }
        });
        this.saveToStorage();
        this.render();
      }

      this.renderMemberManagerTable();
      this.renderMemberFilterBar();
    }
  }

  addCustomMemberFromInput() {
    const rawVal = this.customMemberInput.value.trim();
    if (!rawVal) return;

    const tokens = rawVal.split(/[\s,、\.\/]+/).filter(Boolean);
    tokens.forEach(token => {
      if (!this.allMembers.includes(token)) {
        this.allMembers.push(token);
      }
    });

    this.customMemberInput.value = "";
    this.saveMembersList();

    const currentChecked = this.getSelectedFormMembers();
    tokens.forEach(token => {
      if (!currentChecked.includes(token)) currentChecked.push(token);
    });
    this.renderFormMemberSelector(currentChecked);
    this.renderMemberFilterBar();
  }

  renderMemberFilterBar() {
    let html = `<button class="member-pill ${this.selectedMember === 'ALL' ? 'active' : ''}" data-member="ALL">全員</button>`;
    this.allMembers.forEach(m => {
      const isActive = (this.selectedMember === m) ? 'active' : '';
      html += `<button class="member-pill ${isActive}" data-member="${this.escapeHtml(m)}">${this.escapeHtml(m)}</button>`;
    });
    this.memberFilterList.innerHTML = html;
  }

  renderFormMemberSelector(checkedMembers = []) {
    let html = "";
    this.allMembers.forEach(m => {
      const isChecked = checkedMembers.includes(m) ? "checked" : "";
      html += `
        <label class="member-check-chip">
          <input type="checkbox" value="${this.escapeHtml(m)}" ${isChecked}>
          <span>${this.escapeHtml(m)}</span>
        </label>
      `;
    });
    this.formMemberSelector.innerHTML = html;
  }

  getSelectedFormMembers() {
    const selected = [];
    this.formMemberSelector.querySelectorAll("input[type='checkbox']:checked").forEach(cb => {
      selected.push(cb.value);
    });
    return selected;
  }

  adjustFormForStatus(status) {
    const norm = this.normalizeStatus(status);
    const isField = (norm === "現場");
    const titleGroup = this.formTitle.closest(".form-group");
    const titleLabel = titleGroup.querySelector(".form-label");

    if (isField) {
      this.formTitle.required = true;
      this.formTitle.placeholder = "例: 【渋谷現場】改修工事";
      titleLabel.innerHTML = '案件名・現場名 <span class="required">*</span>';
    } else {
      this.formTitle.required = false;
      this.formTitle.placeholder = `(担当メンバーと備考欄のみ表示されます)`;
      titleLabel.innerHTML = '区分・タイトル (任意)';
    }
  }

  exportDataToFile() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.schedules, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "schedules.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    alert("💾 現在のスケジュールデータ（" + this.schedules.length + "件）を「schedules.json」として書き出しました！");
  }

  handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (Array.isArray(importedData)) {
          if (this.isCloudConnected && this.db) {
            const batch = this.db.batch();
            importedData.forEach(s => {
              const docRef = s.id ? this.db.collection("schedules").doc(s.id) : this.db.collection("schedules").doc();
              batch.set(docRef, {
                title: s.title || "",
                date: s.date,
                status: this.normalizeStatus(s.status),
                details: s.details || "",
                members: s.members || [],
                isEmptySlot: false,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              });
            });
            await batch.commit();
          } else {
            this.schedules = importedData.map(s => ({
              ...s,
              status: this.normalizeStatus(s.status)
            }));
            this.collectMembersFromSchedules();
            this.saveToStorage();
            this.saveMembersToStorage();
            this.renderMemberFilterBar();
            this.render();
          }
          alert(`📂 ファイルから ${importedData.length} 件のスケジュールデータを読み込みました！`);
        }
      } catch (err) {
        alert("ファイルの読み込みに失敗しました: " + err.message);
      }
    };
    reader.readAsText(file);
    this.fileImportInput.value = "";
  }

  stepMonth(direction) {
    const [y, m] = this.currentYearMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + direction, 1);
    const newY = d.getFullYear();
    const newM = String(d.getMonth() + 1).padStart(2, '0');
    this.currentYearMonth = `${newY}-${newM}`;
    this.currentDate = `${newY}-${newM}-01`;
    this.generateDateRange(this.currentDate);
    this.updateHeaderDates();
    this.render();
  }

  switchView(view) {
    this.currentView = view;
    if (view === "pc") {
      if (this.btnPcView) this.btnPcView.classList.add("active");
      if (this.btnMobileView) this.btnMobileView.classList.remove("active");
      if (this.pcSection) this.pcSection.classList.add("active");
      if (this.mobileSection) this.mobileSection.classList.remove("active");
    } else {
      if (this.btnMobileView) this.btnMobileView.classList.add("active");
      if (this.btnPcView) this.btnPcView.classList.remove("active");
      if (this.mobileSection) this.mobileSection.classList.add("active");
      if (this.pcSection) this.pcSection.classList.remove("active");
    }
    this.render();
  }

  formatDateJP(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split('-');
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${y}年${Number(m)}月${Number(d)}日 (${weekdays[dt.getDay()]})`;
  }

  formatShortDate(dateStr) {
    if (!dateStr) return { monthDay: "", weekday: "", isWeekend: false, dayNum: "" };
    const [y, m, d] = dateStr.split('-');
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const isWeekend = (dt.getDay() === 0 || dt.getDay() === 6);
    return {
      monthDay: `${Number(m)}/${Number(d)}`,
      weekday: weekdays[dt.getDay()],
      dayNum: `${Number(d)}`,
      isWeekend
    };
  }

  updateHeaderDates() {
    if (this.currentDateDisplay) {
      this.currentDateDisplay.textContent = this.formatDateJP(this.currentDate);
    }
    if (this.hiddenDatePicker) {
      this.hiddenDatePicker.value = this.currentDate;
    }
    const f = this.formatShortDate(this.currentDate);

    if (this.mobileSubMode === "day") {
      if (this.mobileDateHero) this.mobileDateHero.textContent = `${f.monthDay} (${f.weekday})`;
    } else {
      const [y, m] = this.currentYearMonth.split('-');
      if (this.mobileMonthLabel) this.mobileMonthLabel.textContent = `${y}年${Number(m)}月`;
      if (this.mobileDateHero) this.mobileDateHero.textContent = `${y}年${Number(m)}月 スケジュール`;
    }
  }

  filterList(items) {
    return items.filter(item => {
      if (this.selectedMember !== "ALL") {
        if (!item.members || !item.members.includes(this.selectedMember)) {
          return false;
        }
      }
      if (this.searchKeyword) {
        const full = `${item.title || ''} ${item.details || ''} ${(item.members || []).join(' ')} ${item.status || ''}`.toLowerCase();
        if (!full.includes(this.searchKeyword)) {
          return false;
        }
      }
      return true;
    });
  }

  render() {
    if (this.currentView === "pc") {
      this.renderPcMatrix();
    } else {
      if (this.mobileSubMode === "day") {
        this.renderMobileDaily();
      } else {
        this.renderMobileMonthly();
      }
    }
  }

  calculateStatusTracks(statusItems) {
    const sorted = [...statusItems].sort((a, b) => (a.date > b.date ? 1 : -1));
    const chains = [];
    const visited = new Set();

    sorted.forEach(item => {
      if (visited.has(item.id)) return;

      const chain = [item];
      visited.add(item.id);

      if (item.title) {
        let currDate = item.date;
        while (true) {
          const nextDate = this.addDaysToDateStr(currDate, 1);
          const nextItem = sorted.find(s => !visited.has(s.id) && s.date === nextDate && s.title === item.title);
          if (nextItem) {
            chain.push(nextItem);
            visited.add(nextItem.id);
            currDate = nextDate;
          } else {
            break;
          }
        }
      }
      chains.push(chain);
    });

    const trackAssignments = new Map();
    const tracksOccupiedDates = [];

    chains.forEach(chain => {
      const chainDates = chain.map(it => it.date);

      let assignedTrack = -1;
      for (let t = 0; t < tracksOccupiedDates.length; t++) {
        const hasCollision = chainDates.some(d => tracksOccupiedDates[t].has(d));
        if (!hasCollision) {
          assignedTrack = t;
          break;
        }
      }

      if (assignedTrack === -1) {
        assignedTrack = tracksOccupiedDates.length;
        tracksOccupiedDates.push(new Set());
      }

      chainDates.forEach(d => tracksOccupiedDates[assignedTrack].add(d));
      chain.forEach(it => trackAssignments.set(it.id, assignedTrack));
    });

    const maxTrackCount = Math.max(1, tracksOccupiedDates.length);
    return { trackAssignments, maxTrackCount };
  }

  // ================= PC Matrix View =================
  renderPcMatrix() {
    const filtered = this.filterList(this.schedules);
    const colWidth = 140;
    const minWidth = `${this.dateRange.length * colWidth + 140}px`;

    let html = `<table class="matrix-grid-table" style="min-width: ${minWidth};"><thead><tr><th class="matrix-status-header">ステータス / 日付</th>`;

    this.dateRange.forEach(dStr => {
      const f = this.formatShortDate(dStr);
      const isSelected = (dStr === this.currentDate);
      const isToday = (dStr === this.realToday);
      const colClass = isSelected ? "selected-col" : (isToday ? "today-col" : "");

      html += `
        <th class="${colClass} ${f.isWeekend ? 'weekend-col' : ''}">
          <div class="col-date-text">${f.monthDay}</div>
          <div class="col-weekday-text">(${f.weekday})</div>
        </th>
      `;
    });
    html += `</tr></thead><tbody>`;

    STATUS_LIST.forEach(status => {
      const isFieldStatus = (status === "現場");
      const statusKey = this.getStatusKey(status);

      const statusAllItems = filtered.filter(s => this.normalizeStatus(s.status) === status);
      const { trackAssignments, maxTrackCount } = this.calculateStatusTracks(statusAllItems);

      html += `<tr>`;
      html += `
        <td class="matrix-status-header status-${statusKey}">
          <div class="status-name-cell">
            <span class="legend-color"></span>
            <span>${status}</span>
          </div>
        </td>
      `;

      this.dateRange.forEach(dStr => {
        const isSelected = (dStr === this.currentDate);
        const cellItems = statusAllItems.filter(s => s.date === dStr);

        const itemByTrack = new Map();
        cellItems.forEach(item => {
          const t = trackAssignments.get(item.id) || 0;
          itemByTrack.set(t, item);
        });

        html += `<td class="${isSelected ? 'selected-cell' : ''}">`;
        html += `<div class="matrix-cell-slot">`;

        for (let t = 0; t < maxTrackCount; t++) {
          const item = itemByTrack.get(t);
          if (item) {
            const memberChips = (item.members || []).map(m => `<span class="member-chip-sm">${this.escapeHtml(m)}</span>`).join('');

            const prevDateStr = this.addDaysToDateStr(dStr, -1);
            const nextDateStr = this.addDaysToDateStr(dStr, 1);
            const hasPrev = !!(item.title && filtered.find(s => s.date === prevDateStr && s.title === item.title && this.normalizeStatus(s.status) === status));
            const hasNext = !!(item.title && filtered.find(s => s.date === nextDateStr && s.title === item.title && this.normalizeStatus(s.status) === status));

            let spanClass = "card-span-single";
            let spanIndicator = "";
            if (hasPrev && hasNext) {
              spanClass = "card-span-middle";
              spanIndicator = `<span class="span-link-indicator">(継続)</span>`;
            } else if (!hasPrev && hasNext) {
              spanClass = "card-span-start";
              spanIndicator = `<span class="span-link-indicator">▶</span>`;
            } else if (hasPrev && !hasNext) {
              spanClass = "card-span-end";
              spanIndicator = `<span class="span-link-indicator">◀</span>`;
            }

            html += `<div class="matrix-cell-track-slot">`;
            if (isFieldStatus) {
              html += `
                <div class="schedule-matrix-card card-status-${statusKey} ${spanClass}" onclick="window.app.openDetailModal('${item.id}')" title="クリックしてこの日の詳細・編集 (${dStr})">
                  <div class="card-title-line">
                    ${this.escapeHtml(item.title || '(案件名未設定)')}
                    ${spanIndicator}
                  </div>
                  ${item.details ? `<div class="card-details-line">${this.escapeHtml(item.details)}</div>` : ''}
                  ${memberChips ? `<div class="card-members-line">${memberChips}</div>` : ''}
                </div>
              `;
            } else {
              const hasInfo = memberChips || item.details;
              html += `
                <div class="schedule-matrix-card card-status-${statusKey} card-non-field ${spanClass}" onclick="window.app.openDetailModal('${item.id}')" title="クリックしてこの日の詳細・編集 (${dStr})">
                  ${memberChips ? `<div class="card-members-line card-members-prominent">${memberChips} ${spanIndicator}</div>` : ''}
                  ${item.details ? `<div class="card-details-line">${this.escapeHtml(item.details)}</div>` : ''}
                  ${!hasInfo ? `<div class="card-details-line" style="color:var(--text-muted); font-size:11px;">(登録あり) ${spanIndicator}</div>` : ''}
                </div>
              `;
            }
            html += `</div>`;
          } else if (cellItems.length > 0) {
            html += `<div class="empty-track-spacer"></div>`;
          }
        }

        if (this.isAdmin) {
          html += `<div class="empty-matrix-slot" title="クリックしてこの日・ステータスに予定を追加" onclick="window.app.openCreateModal('${dStr}', '${status}')"></div>`;
        }

        html += `</div></td>`;
      });

      html += `</tr>`;
    });

    html += `</tbody></table>`;
    this.matrixTableContainer.innerHTML = html;
  }

  // ================= Mobile Day View =================
  renderMobileDaily() {
    let stripHtml = "";
    this.dateRange.forEach(dStr => {
      const f = this.formatShortDate(dStr);
      const isActive = (dStr === this.currentDate) ? "active" : "";
      stripHtml += `
        <button class="mobile-date-pill ${isActive}" onclick="window.app.selectDate('${dStr}')">
          <span class="pill-weekday">${f.weekday}</span>
          <span class="pill-day">${f.dayNum}</span>
        </button>
      `;
    });
    this.mobileDateStrip.innerHTML = stripHtml;

    const dayItems = this.filterList(this.schedules).filter(s => s.date === this.currentDate);

    let html = "";
    if (dayItems.length === 0) {
      html = `
        <div class="mobile-empty-state">
          <div class="empty-icon">☕</div>
          <div class="empty-title">この日の予定はありません</div>
          ${this.isAdmin ? `<div class="empty-desc">画面右下の「＋」ボタンから追加できます</div>` : ''}
        </div>
      `;
    } else {
      STATUS_LIST.forEach(status => {
        const isFieldStatus = (status === "現場");
        const groupItems = dayItems.filter(s => this.normalizeStatus(s.status) === status);
        if (groupItems.length === 0) return;
        const statusKey = this.getStatusKey(status);

        html += `
          <div class="mobile-status-group group-${statusKey}">
            <div class="mobile-group-header">
              <div class="group-header-left">
                <span class="status-indicator"></span>
                <span class="group-title">${status}</span>
              </div>
              <span class="group-count-tag">${groupItems.length}件</span>
            </div>
            <div class="mobile-group-body">
        `;

        groupItems.forEach(item => {
          const memberTags = (item.members || []).map(m => `<span class="member-chip-sm">${this.escapeHtml(m)}</span>`).join('');

          if (isFieldStatus) {
            html += `
              <div class="mobile-event-card" onclick="window.app.openDetailModal('${item.id}')">
                <div class="event-title">${this.escapeHtml(item.title || '(案件名未設定)')}</div>
                ${item.details ? `<div class="event-details">${this.escapeHtml(item.details)}</div>` : ''}
                <div class="event-footer">
                  <div class="event-members">${memberTags}</div>
                  <span class="view-detail-hint">${this.isAdmin ? '詳細 / 編集' : '詳細'} &rsaquo;</span>
                </div>
              </div>
            `;
          } else {
            html += `
              <div class="mobile-event-card mobile-event-card-compact" onclick="window.app.openDetailModal('${item.id}')">
                <div class="event-footer" style="margin-top:0; padding-top:0; border-top:none;">
                  <div class="event-members event-members-large">${memberTags || '<span style="font-size:11px; color:var(--text-muted);">未設定</span>'}</div>
                  <span class="view-detail-hint">${this.isAdmin ? '詳細 / 編集' : '詳細'} &rsaquo;</span>
                </div>
                ${item.details ? `<div class="event-details" style="margin-top:6px;">${this.escapeHtml(item.details)}</div>` : ''}
              </div>
            `;
          }
        });

        html += `
            </div>
          </div>
        `;
      });
    }

    this.mobileCardsContainer.innerHTML = html;
  }

  // ================= Mobile Month View =================
  renderMobileMonthly() {
    const [yearStr, monthStr] = this.currentYearMonth.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekday = firstDay.getDay();

    const filtered = this.filterList(this.schedules);

    let gridHtml = "";
    for (let i = 0; i < startWeekday; i++) {
      gridHtml += `<div class="cal-day-cell other-month"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isSelected = (dateStr === this.currentDate);
      const isToday = (dateStr === this.realToday);

      const daySchedules = filtered.filter(s => s.date === dateStr);

      let dotsHtml = "";
      if (daySchedules.length > 0) {
        const statuses = Array.from(new Set(daySchedules.map(s => this.normalizeStatus(s.status)))).slice(0, 3);
        dotsHtml = `<div class="cal-dots">` + statuses.map(st => `<span class="cal-dot cal-dot-${this.getStatusKey(st)}"></span>`).join('') + `</div>`;
      }

      gridHtml += `
        <div class="cal-day-cell ${isSelected ? 'selected-day' : ''} ${isToday ? 'today-marker' : ''}" onclick="window.app.onSelectMonthDay('${dateStr}')">
          <span>${d}</span>
          ${dotsHtml}
        </div>
      `;
    }
    this.mobileMonthCalendarGrid.innerHTML = gridHtml;

    const monthSchedules = filtered.filter(s => s.date && s.date.startsWith(this.currentYearMonth));

    if (this.mobileAgendaTitle) this.mobileAgendaTitle.textContent = `${month}月の全スケジュール`;
    if (this.mobileAgendaCount) this.mobileAgendaCount.textContent = `${monthSchedules.length}件`;

    let agendaHtml = "";
    if (monthSchedules.length === 0) {
      agendaHtml = `<div class="mobile-empty-state"><div class="empty-title">この月の予定はありません</div></div>`;
    } else {
      const dateGroups = {};
      monthSchedules.forEach(s => {
        if (!dateGroups[s.date]) dateGroups[s.date] = [];
        dateGroups[s.date].push(s);
      });

      const sortedDates = Object.keys(dateGroups).sort();
      sortedDates.forEach(dStr => {
        const items = dateGroups[dStr];
        const f = this.formatShortDate(dStr);
        const isSelected = (dStr === this.currentDate);

        agendaHtml += `
          <div class="agenda-day-block ${isSelected ? 'agenda-day-selected' : ''}">
            <div class="agenda-day-heading" onclick="window.app.onSelectMonthDay('${dStr}')">
              <span>📅 ${f.monthDay} (${f.weekday})</span>
              <span>${items.length}件</span>
            </div>
            <div class="mobile-group-body" style="padding: 4px 0;">
        `;

        items.forEach(item => {
          const normStatus = this.normalizeStatus(item.status);
          const isField = (normStatus === "現場");
          const memberTags = (item.members || []).map(m => `<span class="member-chip-sm">${this.escapeHtml(m)}</span>`).join('');
          const statusKey = this.getStatusKey(normStatus);

          agendaHtml += `
            <div class="mobile-event-card ${!isField ? 'mobile-event-card-compact' : ''}" onclick="window.app.openDetailModal('${item.id}')">
              ${isField ? `
                <div class="event-title"><span class="legend-color" style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--status-field-accent); margin-right:4px;"></span>${this.escapeHtml(item.title || '(現場)')}</div>
                ${item.details ? `<div class="event-details">${this.escapeHtml(item.details)}</div>` : ''}
                <div class="event-footer">
                  <div class="event-members">${memberTags}</div>
                  <span class="view-detail-hint">詳細 &rsaquo;</span>
                </div>
              ` : `
                <div class="event-footer" style="margin-top:0; padding-top:0; border-top:none;">
                  <span class="modal-status-pill status-${statusKey}" style="font-size:10px; padding:2px 8px;">${normStatus}</span>
                  <div class="event-members">${memberTags || '<span style="font-size:10px; color:var(--text-muted);">未設定</span>'}</div>
                  <span class="view-detail-hint">詳細 &rsaquo;</span>
                </div>
                ${item.details ? `<div class="event-details" style="margin-top:4px;">${this.escapeHtml(item.details)}</div>` : ''}
              `}
            </div>
          `;
        });

        agendaHtml += `</div></div>`;
      });
    }

    this.mobileMonthAgendaList.innerHTML = agendaHtml;
  }

  onSelectMonthDay(dateStr) {
    this.currentDate = dateStr;
    this.switchSpan("week");
  }

  selectDate(dateStr) {
    this.currentDate = dateStr;
    this.updateHeaderDates();
    this.render();
  }

  getStatusKey(status) {
    const norm = this.normalizeStatus(status);
    if (norm.includes("現場")) return "field";
    if (norm.includes("社内")) return "office";
    if (norm.includes("休") || norm.includes("有休")) return "off";
    if (norm.includes("泊") || norm.includes("5階") || norm.includes("ﾎﾃル")) return "stay";
    return "field";
  }

  openDetailModal(itemId) {
    let item = this.schedules.find(s => s.id === itemId);
    if (!item) return;

    this.activeModalItemId = item.id;
    const normStatus = this.normalizeStatus(item.status);
    const statusKey = this.getStatusKey(normStatus);
    const isField = (normStatus === "現場");

    this.modalTitle.textContent = isField ? (item.title || "(現場予定)") : `${normStatus}`;
    this.modalStatusPill.textContent = normStatus;
    this.modalStatusPill.className = `modal-status-pill status-${statusKey}`;
    this.modalDate.textContent = this.formatDateJP(item.date);

    if (item.members && item.members.length > 0) {
      this.modalMembers.innerHTML = item.members.map(m => `<span class="member-chip-lg">${this.escapeHtml(m)}</span>`).join('');
    } else {
      this.modalMembers.innerHTML = `<span class="text-muted">未設定</span>`;
    }

    this.modalDetails.textContent = item.details || "備考・特記事項の記載はありません。";

    this.detailModal.classList.add("active");
    this.detailModal.setAttribute("aria-hidden", "false");
  }

  closeDetailModal() {
    this.detailModal.classList.remove("active");
    this.detailModal.setAttribute("aria-hidden", "true");
  }

  openCreateModal(dateStr, defaultStatus = "現場") {
    this.editItemId.value = "";
    this.editModalHeaderTitle.textContent = "新しい予定の作成";
    this.formTitle.value = "";
    this.formDate.value = dateStr || this.currentDate;
    this.formEndDate.value = dateStr || this.currentDate;
    this.formStatus.value = this.normalizeStatus(defaultStatus || "現場");
    this.formDetails.value = "";
    this.customMemberInput.value = "";
    this.chkBatchRange.checked = false;
    this.batchDatesInputs.style.display = "none";
    this.batchRangeBox.style.display = "block";
    this.btnDeleteSchedule.style.display = "none";

    this.adjustFormForStatus(this.formStatus.value);
    this.renderFormMemberSelector([]);

    this.editModal.classList.add("active");
    this.editModal.setAttribute("aria-hidden", "false");
    if (this.normalizeStatus(defaultStatus) === "現場") {
      this.formTitle.focus();
    } else {
      this.formDetails.focus();
    }
  }

  openEditModal(itemId) {
    const item = this.schedules.find(s => s.id === itemId);
    if (!item) return;

    this.editItemId.value = item.id;
    this.editModalHeaderTitle.textContent = "予定の編集";
    this.formTitle.value = item.title || "";
    this.formDate.value = item.date || this.currentDate;
    this.formStatus.value = this.normalizeStatus(item.status || "現場");
    this.formDetails.value = item.details || "";
    this.customMemberInput.value = "";
    this.batchRangeBox.style.display = "none";
    this.btnDeleteSchedule.style.display = "inline-block";

    this.adjustFormForStatus(this.formStatus.value);

    const members = item.members || [];
    members.forEach(m => {
      if (!this.allMembers.includes(m)) this.allMembers.push(m);
    });
    this.renderFormMemberSelector(members);

    this.editModal.classList.add("active");
    this.editModal.setAttribute("aria-hidden", "false");
  }

  closeEditModal() {
    this.editModal.classList.remove("active");
    this.editModal.setAttribute("aria-hidden", "true");
  }

  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.app = new ScheduleApp();
});