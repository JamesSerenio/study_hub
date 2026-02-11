// src/pages/Staff_menu.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  IonButtons,
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonMenu,
  IonMenuButton,
  IonMenuToggle,
  IonSplitPane,
  IonToolbar,
  IonIcon,
  IonPage,
  IonSpinner,
} from "@ionic/react";
import { logOutOutline } from "ionicons/icons";
import { useHistory } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

/* ✅ supabase */
import { supabase } from "../utils/supabaseClient";
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimePostgresDeletePayload,
} from "@supabase/supabase-js";

/* pages */
import Staff_Dashboard from "./Staff_Dashboard";
import Customer_Lists from "./Customer_Lists";
import Customer_Reservations from "./Customer_Reservations";
import Customer_Calendar from "./Customer_Calendar";
import Product_Item_Lists from "./Product_Item_lists";
import Customer_Add_ons from "./Customer_Add_ons";
import Customer_Discount_List from "./Customer_Promo_List";
import Staff_Sales_Report from "./staff_sales_report";
import Customer_Cancelled from "./Customer_Cancelled";
import Staff_Consignment from "./Staff_Consignment"; // ✅ NEW
import Staff_Consignment_Record from "./Staff_Consignment_Record"; // ✅ NEW

/* assets */
import dashboardIcon from "../assets/add_user.png";
import studyHubLogo from "../assets/study_hub.png";
import listIcon from "../assets/list.png";
import reserveIcon from "../assets/reserve.png";
import calendarIcon from "../assets/calendar.png";
import foodIcon from "../assets/food.png";
import onsIcon from "../assets/hamburger.png";
import discountIcon from "../assets/discount.png";
import salesIcon from "../assets/sales.png";
import flowerImg from "../assets/flower.png";
import cancelledIcon from "../assets/cancelled.png";
import bellIcon from "../assets/bell.png";
import consignmentIcon from "../assets/consignment.png"; // ✅ NEW
import consignmentRecordIcon from "../assets/consignment_record.png"; // ✅ NEW

type FlowerStatic = {
  id: string;
  left: string;
  top: string;
  size: string;
  opacity: number;
  rotateDeg?: number;
};

type AddOnNotifRow = {
  id: string;
  created_at: string;

  add_on_row_id: string;

  full_name: string;
  seat_number: string;

  add_on_id: string;
  add_on_name: string;

  quantity: number;
  price: number;
  total: number;

  is_read: boolean;
  read_at: string | null;
};

const toMoney = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const Staff_menu: React.FC = () => {
  const history = useHistory();
  const [activePage, setActivePage] = useState("dashboard");

  /* ✅ first-load layout fix */
  const [boot, setBoot] = useState(false);

  /* =========================
      🔔 Notifications
  ========================= */
  const NOTIF_TABLE = "add_on_notifications";

  const [notifOpen, setNotifOpen] = useState<boolean>(false);
  const notifOpenRef = useRef<boolean>(false);

  const [notifLoading, setNotifLoading] = useState<boolean>(false);
  const [notifItems, setNotifItems] = useState<AddOnNotifRow[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // refs
  const bellWrapRef = useRef<HTMLDivElement | null>(null);
  const bellBtnRef = useRef<HTMLButtonElement | null>(null);

  // popover position
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number }>({
    top: 64,
    right: 12,
  });

  // ✅ keep ref synced for realtime callbacks
  useEffect(() => {
    notifOpenRef.current = notifOpen;
  }, [notifOpen]);

  const formatPHDateTime = (iso: string): string => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  };

  const fetchUnreadCount = async (): Promise<number> => {
    const { count, error } = await supabase
      .from(NOTIF_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("is_read", false);

    if (error) return unreadCount;
    const n = Number(count ?? 0);
    setUnreadCount(n);
    return n;
  };

  const fetchNotifications = async (): Promise<void> => {
    setNotifLoading(true);

    const { data, error } = await supabase
      .from(NOTIF_TABLE)
      .select(
        "id, created_at, add_on_row_id, full_name, seat_number, add_on_id, add_on_name, quantity, price, total, is_read, read_at"
      )
      .order("created_at", { ascending: false })
      .limit(30);

    setNotifLoading(false);

    if (error) {
      // eslint-disable-next-line no-console
      console.warn("fetchNotifications:", error.message);
      setNotifItems([]);
      return;
    }

    setNotifItems((data as AddOnNotifRow[]) ?? []);
  };

  /* =========================
      ✅ REALTIME refresh (debounced)
  ========================= */
  const refreshTimerRef = useRef<number | null>(null);
  const suspendRefreshRef = useRef<boolean>(false);

  const cancelScheduledRefresh = (): void => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  };

  const scheduleRecount = (delayMs = 220): void => {
    if (suspendRefreshRef.current) return;
    cancelScheduledRefresh();
    refreshTimerRef.current = window.setTimeout(() => {
      if (suspendRefreshRef.current) return;
      void fetchUnreadCount();
      if (notifOpenRef.current) void fetchNotifications();
    }, delayMs);
  };

  /* =========================
      ✅ AUTO-READ on open
  ========================= */
  const markAllAsReadSilent = async (): Promise<void> => {
    cancelScheduledRefresh();
    suspendRefreshRef.current = true;

    // instant hide badge
    setUnreadCount(0);

    const nowIso = new Date().toISOString();

    // ✅ update only unread
    const { error } = await supabase.from(NOTIF_TABLE).update({ is_read: true, read_at: nowIso }).eq("is_read", false);

    if (error) {
      // eslint-disable-next-line no-console
      console.warn("markAllAsReadSilent:", error.message);
      suspendRefreshRef.current = false;
      await fetchUnreadCount();
      return;
    }

    // update UI list too
    setNotifItems((prev) => prev.map((n) => ({ ...n, is_read: true, read_at: nowIso })));

    await sleep(180);
    await fetchUnreadCount();
    suspendRefreshRef.current = false;
  };

  const computePopoverPosition = (): void => {
    const btn = bellBtnRef.current;
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const top = Math.round(r.bottom + 10);
    const right = Math.max(12, Math.round(window.innerWidth - r.right));
    setPopoverPos({ top, right });
  };

  const openBell = async (): Promise<void> => {
    computePopoverPosition();
    setNotifOpen(true);

    await fetchNotifications();
    await markAllAsReadSilent();

    if (notifOpenRef.current) await fetchNotifications();
  };

  const closeBell = (): void => setNotifOpen(false);

  const toggleBell = async (): Promise<void> => {
    if (notifOpen) closeBell();
    else await openBell();
  };

  /* ✅ close dropdown on outside click */
  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!notifOpenRef.current) return;
      const wrap = bellWrapRef.current;
      if (!wrap) return;
      if (!wrap.contains(e.target as Node)) setNotifOpen(false);
    };

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  /* ✅ reposition on resize */
  useEffect(() => {
    const onResize = (): void => {
      if (notifOpenRef.current) computePopoverPosition();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ✅ REALTIME SUBSCRIBE ONCE (INSTANT BADGE) */
  useEffect(() => {
    void fetchUnreadCount();
    void fetchNotifications();

    const ch = supabase
      .channel("realtime_add_on_notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: NOTIF_TABLE },
        (payload: RealtimePostgresInsertPayload<AddOnNotifRow>) => {
          const newRow = payload.new;

          setNotifItems((prev) => {
            if (prev.some((x) => x.id === newRow.id)) return prev;
            return [newRow, ...prev].slice(0, 30);
          });

          if (notifOpenRef.current) {
            void markAllAsReadSilent();
          } else {
            if (!newRow.is_read) setUnreadCount((c) => c + 1);
          }

          scheduleRecount(600);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: NOTIF_TABLE },
        (payload: RealtimePostgresUpdatePayload<AddOnNotifRow>) => {
          const newRow = payload.new;
          const oldRow = payload.old;

          setNotifItems((prev) => {
            const idx = prev.findIndex((x) => x.id === newRow.id);
            if (idx === -1) return prev;
            const copy = [...prev];
            copy[idx] = newRow;
            return copy;
          });

          if (!notifOpenRef.current) {
            const wasUnread = oldRow ? !(oldRow as Partial<AddOnNotifRow>).is_read : null;
            const isUnreadNow = !newRow.is_read;

            if (wasUnread === true && isUnreadNow === false) {
              setUnreadCount((c) => Math.max(0, c - 1));
            } else if (wasUnread === false && isUnreadNow === true) {
              setUnreadCount((c) => c + 1);
            } else {
              scheduleRecount(350);
            }
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: NOTIF_TABLE },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (_payload: RealtimePostgresDeletePayload<AddOnNotifRow>) => {
          scheduleRecount(250);
        }
      )
      .subscribe((status) => {
        // eslint-disable-next-line no-console
        console.log("NOTIF CHANNEL:", status);
      });

    const onFocusOrWake = (): void => {
      void fetchUnreadCount();
      if (notifOpenRef.current) void fetchNotifications();
    };

    window.addEventListener("focus", onFocusOrWake);
    window.addEventListener("online", onFocusOrWake);
    document.addEventListener("visibilitychange", onFocusOrWake);

    return () => {
      window.removeEventListener("focus", onFocusOrWake);
      window.removeEventListener("online", onFocusOrWake);
      document.removeEventListener("visibilitychange", onFocusOrWake);

      cancelScheduledRefresh();
      suspendRefreshRef.current = false;

      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ✅ boot tick */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setBoot(true);
      window.dispatchEvent(new Event("resize"));
      document.body.getBoundingClientRect();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const menuItems = useMemo(
    () => [
      { name: "Dashboard", key: "dashboard", icon: dashboardIcon },
      { name: "Customer Lists", key: "customer_lists", icon: listIcon },
      { name: "Customer Reservations", key: "customer_reservations", icon: reserveIcon },
      { name: "Customer Calendar", key: "customer_calendar", icon: calendarIcon },
      { name: "Customer Add-Ons", key: "customer_add_ons", icon: onsIcon },
      { name: "Customer Cancelled", key: "customer_cancelled", icon: cancelledIcon },
      { name: "Memberships", key: "customer_promo_list", icon: discountIcon },
      { name: "Sales Report", key: "staff_sales_report", icon: salesIcon },
      { name: "Product Item Lists", key: "product_item_lists", icon: foodIcon },
      { name: "Add Consignment", key: "staff_consignment", icon: consignmentIcon }, // ✅ NEW
      { name: "Consignment Record", key: "staff_consignment_record", icon: consignmentRecordIcon }, // ✅ NEW
    ],
    []
  );

  const flowers: FlowerStatic[] = useMemo(
    () => [
      { id: "big-tr", left: "62%", top: "10%", size: "260px", opacity: 0.18, rotateDeg: 0 },
      { id: "big-bl", left: "-10%", top: "70%", size: "320px", opacity: 0.16, rotateDeg: 0 },
      { id: "s1", left: "58%", top: "52%", size: "110px", opacity: 0.18, rotateDeg: 0 },
      { id: "s2", left: "73%", top: "62%", size: "95px", opacity: 0.18, rotateDeg: 0 },
      { id: "s3", left: "64%", top: "74%", size: "105px", opacity: 0.18, rotateDeg: 0 },
      { id: "s4", left: "78%", top: "78%", size: "90px", opacity: 0.18, rotateDeg: 0 },
      { id: "s5", left: "54%", top: "86%", size: "85px", opacity: 0.16, rotateDeg: 0 },
    ],
    []
  );

  const renderContent = () => {
    switch (activePage) {
      case "dashboard":
        return <Staff_Dashboard />;
      case "customer_lists":
        return <Customer_Lists />;
      case "customer_reservations":
        return <Customer_Reservations />;
      case "customer_calendar":
        return <Customer_Calendar />;
      case "customer_add_ons":
        return <Customer_Add_ons />;
      case "customer_cancelled":
        return <Customer_Cancelled />;
      case "customer_promo_list":
        return <Customer_Discount_List />;
      case "staff_sales_report":
        return <Staff_Sales_Report />;
      case "product_item_lists":
        return <Product_Item_Lists />;
      case "staff_consignment":
        return <Staff_Consignment />; // ✅ NEW
      case "staff_consignment_record":
        return <Staff_Consignment_Record />; // ✅ NEW
      default:
        return <Staff_Dashboard />;
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    sessionStorage.clear();
    history.replace("/login");
  };

  const listVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -12 },
    show: { opacity: 1, x: 0, transition: { duration: 0.22 } },
  };

  return (
    <IonPage className="staff-shell-page">
      <IonSplitPane contentId="main" when="(min-width: 768px)">
        {/* SIDEBAR */}
        <IonMenu contentId="main" className="staff-menu">
          <IonHeader className="staff-menu-header">
            <IonToolbar>
              <div className="menu-brand">
                <img src={studyHubLogo} alt="Study Hub" className="menu-logo" />
                <span className="menu-title-text figma-title">Me Tyme Lounge</span>
              </div>
            </IonToolbar>
          </IonHeader>

          <IonContent className="staff-menu-content">
            <div className="menu-flowers" aria-hidden="true">
              {flowers.map((f) => (
                <img
                  key={f.id}
                  src={flowerImg}
                  alt=""
                  className="menu-flower"
                  draggable={false}
                  style={{
                    left: f.left,
                    top: f.top,
                    width: f.size,
                    height: f.size,
                    opacity: f.opacity,
                    transform: `rotate(${f.rotateDeg ?? 0}deg)`,
                  }}
                />
              ))}
            </div>

            <motion.div className="menu-items-layer" variants={listVariants} initial="hidden" animate="show">
              {menuItems.map((item) => (
                <IonMenuToggle key={item.key} autoHide={false}>
                  <motion.div variants={itemVariants} whileHover={{ x: 3 }}>
                    <IonItem
                      button
                      lines="none"
                      className={`menu-item ${activePage === item.key ? "active" : ""}`}
                      onClick={() => setActivePage(item.key)}
                    >
                      <img src={item.icon} alt={item.name} className="menu-icon" />
                      <span className="menu-text">{item.name}</span>
                    </IonItem>
                  </motion.div>
                </IonMenuToggle>
              ))}

              <IonMenuToggle autoHide={false}>
                <motion.div variants={itemVariants}>
                  <IonButton className="logout-btn" onClick={handleLogout}>
                    <IonIcon icon={logOutOutline} slot="start" />
                    Logout
                  </IonButton>
                </motion.div>
              </IonMenuToggle>
            </motion.div>
          </IonContent>
        </IonMenu>

        {/* MAIN */}
        <div id="main" className="staff-main-shell">
          <IonHeader>
            <IonToolbar className="staff-topbar">
              <IonButtons slot="start">
                <IonMenuButton />
              </IonButtons>

              <span className="topbar-title">Staff Dashboard</span>

              <IonButtons slot="end">
                <div className="topbar-tools" ref={bellWrapRef}>
                  <button
                    ref={bellBtnRef}
                    className="notif-bell-btn"
                    onClick={() => void toggleBell()}
                    aria-label="Notifications"
                    type="button"
                  >
                    <img src={bellIcon} alt="Notifications" className="notif-bell-icon" />
                    {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
                  </button>
                </div>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding custom-bg">
            {boot && (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activePage}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -18 }}
                  transition={{ duration: 0.25 }}
                >
                  {renderContent()}
                </motion.div>
              </AnimatePresence>
            )}
          </IonContent>

          {/* ✅ POPOVER */}
          {notifOpen && (
            <div
              className="notif-popover notif-popover--fixed"
              style={{ top: `${popoverPos.top}px`, right: `${popoverPos.right}px` }}
              role="dialog"
              aria-label="Add-ons notifications"
            >
              <div className="notif-popover-head">
                <div>
                  <div className="notif-title">Add-Ons Notifications</div>
                  <div className="notif-subtitle">Live updates • auto-read on open</div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button className="notif-close-btn" onClick={closeBell} aria-label="Close" type="button">
                    ✕
                  </button>
                </div>
              </div>

              <div className="notif-grid-head">
                <div>Fullname</div>
                <div>Seat</div>
                <div>Date/Time</div>
                <div>Item</div>
                <div className="t-right">Qty</div>
                <div className="t-right">Price</div>
                <div className="t-right">Total</div>
              </div>

              <div className="notif-popover-body">
                {notifLoading ? (
                  <div className="notif-empty">
                    <IonSpinner name="dots" />
                  </div>
                ) : notifItems.length === 0 ? (
                  <div className="notif-empty">No notifications yet.</div>
                ) : (
                  notifItems.map((n) => (
                    <div key={n.id} className={`notif-row ${n.is_read ? "" : "notif-row--unread"}`}>
                      <div className="ellipsis">{n.full_name}</div>
                      <div className="seat-pill">{n.seat_number}</div>
                      <div className="dt">{formatPHDateTime(n.created_at)}</div>
                      <div className="ellipsis">{n.add_on_name}</div>
                      <div className="t-right">{Number(n.quantity)}</div>
                      <div className="t-right">₱{toMoney(n.price).toFixed(2)}</div>
                      <div className="t-right total">₱{toMoney(n.total).toFixed(2)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </IonSplitPane>
    </IonPage>
  );
};

export default Staff_menu;
