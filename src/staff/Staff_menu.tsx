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
import Staff_Consignment from "./Staff_Consignment";
import Staff_Consignment_Record from "./Staff_Consignment_Record";
import Customer_Consignment_Record from "./Customer_Consignment_Record";

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
import consignmentIcon from "../assets/consignment.png";
import staff_consignmentIcon from "../assets/staff_consignment.png";
import consignmentRecordIcon from "../assets/consignment_record.png";

type FlowerStatic = {
  id: string;
  left: string;
  top: string;
  size: string;
  opacity: number;
  rotateDeg?: number;
};

type NoisyNotifRow = {
  id: string;
  created_at: string;
  name: string;
  seat_number: string;
  report_type: string | null;
  message: string | null;
  concern?: string | null;
  status: string | null;
  is_read: boolean;
  read_at: string | null;
};

type RealtimeInsertPayload<T> = {
  new: T;
};

type RealtimeUpdatePayload<T> = {
  new: T;
  old: Partial<T>;
};


const Staff_menu: React.FC = () => {
  const history = useHistory();
  const [activePage, setActivePage] = useState("dashboard");
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);
  const [boot, setBoot] = useState(false);

  /* =========================
      🔔 Notifications
  ========================= */
  const NOISY_TABLE = "noisy_reports";

  const [notifOpen, setNotifOpen] = useState<boolean>(false);
  const notifOpenRef = useRef<boolean>(false);

  const [notifLoading, setNotifLoading] = useState<boolean>(false);
  const [notifItems, setNotifItems] = useState<NoisyNotifRow[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const bellBtnRef = useRef<HTMLButtonElement | null>(null);

  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number }>(
    {
      top: 64,
      right: 12,
    }
  );

  const refreshTimerRef = useRef<number | null>(null);
  const suspendRefreshRef = useRef<boolean>(false);

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

  const normalizeType = (value: string | null | undefined): string => {
    const v = String(value ?? "other").trim().toLowerCase();
    if (
      v === "concern" ||
      v === "feedback" ||
      v === "suggestion" ||
      v === "complaint" ||
      v === "request" ||
      v === "other"
    ) {
      return v;
    }
    return "other";
  };

  const getTypeLabel = (value: string | null | undefined): string => {
    const v = normalizeType(value);
    return v.charAt(0).toUpperCase() + v.slice(1);
  };

  const getAvatarText = (name: string): string => {
    const trimmed = name.trim();
    if (!trimmed) return "?";
    return trimmed.charAt(0).toUpperCase();
  };

  const getMessageText = (row: NoisyNotifRow): string => {
    return String(row.message ?? row.concern ?? "").trim() || "No message.";
  };

  const cancelScheduledRefresh = (): void => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = null;
  };

  const scheduleRecount = (delayMs = 220): void => {
    if (suspendRefreshRef.current) return;
    cancelScheduledRefresh();

    refreshTimerRef.current = window.setTimeout(() => {
      if (suspendRefreshRef.current) return;
      void fetchUnreadCount();
      if (!notifOpenRef.current) return;
    }, delayMs);
  };

  const fetchUnreadCount = async (): Promise<number> => {
    const result = await supabase
      .from(NOISY_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("is_read", false);

    const total = result.error ? 0 : Number(result.count ?? 0);
    setUnreadCount(total);
    return total;
  };

  const fetchNotifications = async (): Promise<void> => {
    setNotifLoading(true);

    const { data, error } = await supabase
      .from(NOISY_TABLE)
      .select(
        "id, created_at, name, seat_number, report_type, message, concern, status, is_read, read_at"
      )
      .order("created_at", { ascending: false })
      .limit(40);

    setNotifLoading(false);

    if (error) {
      console.warn("fetch noisy notifications:", error.message);
      return;
    }

    setNotifItems((data as NoisyNotifRow[] | null) ?? []);
  };

  const markAllAsReadSilent = async (): Promise<void> => {
    if (suspendRefreshRef.current) return;

    cancelScheduledRefresh();
    suspendRefreshRef.current = true;

    const nowIso = new Date().toISOString();

    setUnreadCount(0);
    setNotifItems((prev) =>
      prev.map((n) => ({
        ...n,
        is_read: true,
        read_at: nowIso,
      }))
    );

    const { error } = await supabase
      .from(NOISY_TABLE)
      .update({ is_read: true, read_at: nowIso })
      .eq("is_read", false);

    if (error) {
      console.warn("markAllAsReadSilent:", error.message);
      await fetchUnreadCount();
      if (notifOpenRef.current) {
        await fetchNotifications();
      }
    }

    suspendRefreshRef.current = false;
  };

  const handleDeleteNotification = async (id: string): Promise<void> => {
    const ok = window.confirm("Delete this message?");
    if (!ok) return;

    const current = notifItems.find((x) => x.id === id);

    const { error } = await supabase.from(NOISY_TABLE).delete().eq("id", id);

    if (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }

    setNotifItems((prev) => prev.filter((x) => x.id !== id));

    if (current && !current.is_read) {
      setUnreadCount((c) => Math.max(0, c - 1));
    } else {
      void fetchUnreadCount();
    }
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
    void markAllAsReadSilent();
  };

  const closeBell = (): void => {
    setNotifOpen(false);
  };

  const toggleBell = async (): Promise<void> => {
    if (notifOpen) {
      closeBell();
    } else {
      await openBell();
    }
  };

  useEffect(() => {
    const onResize = (): void => {
      if (notifOpenRef.current) computePopoverPosition();
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    void fetchUnreadCount();
    void fetchNotifications();

    const ch = supabase
      .channel("realtime_noisy_reports_notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: NOISY_TABLE },
        (payload: unknown) => {
          const row = (payload as RealtimeInsertPayload<NoisyNotifRow>).new;

          setNotifItems((prev) => {
            if (prev.some((x) => x.id === row.id)) return prev;
            const merged = [row, ...prev].sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
            );
            return merged.slice(0, 40);
          });

          if (notifOpenRef.current) {
            void markAllAsReadSilent();
          } else if (!row.is_read) {
            setUnreadCount((c) => c + 1);
            scheduleRecount(600);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: NOISY_TABLE },
        (payload: unknown) => {
          const p = payload as RealtimeUpdatePayload<NoisyNotifRow>;
          const newRow = p.new;
          const oldRow = p.old;

          setNotifItems((prev) => {
            const idx = prev.findIndex((x) => x.id === newRow.id);
            if (idx === -1) return prev;

            const copy = [...prev];
            copy[idx] = newRow;
            return copy;
          });

          if (notifOpenRef.current) return;

          const wasUnread =
            oldRow.is_read === undefined ? null : !oldRow.is_read;
          const isUnreadNow = !newRow.is_read;

          if (wasUnread === true && isUnreadNow === false) {
            setUnreadCount((c) => Math.max(0, c - 1));
          } else if (wasUnread === false && isUnreadNow === true) {
            setUnreadCount((c) => c + 1);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: NOISY_TABLE },
        () => {
          if (!notifOpenRef.current) {
            scheduleRecount(250);
          } else {
            void fetchUnreadCount();
          }
        }
      )
      .subscribe((status) => {
        console.log("NOISY NOTIF CHANNEL:", status);
      });

    const onFocusOrWake = (): void => {
      void fetchUnreadCount();
      if (notifOpenRef.current) {
        computePopoverPosition();
      }
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
  }, []);

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
      {
        name: "Customer Reservations",
        key: "customer_reservations",
        icon: reserveIcon,
      },
      { name: "Customer Calendar", key: "customer_calendar", icon: calendarIcon },
      { name: "Customer Add-Ons", key: "customer_add_ons", icon: onsIcon },
      { name: "Customer Cancelled", key: "customer_cancelled", icon: cancelledIcon },
      { name: "Memberships", key: "customer_promo_list", icon: discountIcon },
      { name: "Sales Report", key: "staff_sales_report", icon: salesIcon },
      { name: "Product Item Lists", key: "product_item_lists", icon: foodIcon },
      { name: "Add Consignment", key: "staff_consignment", icon: consignmentIcon },
      {
        name: "Consignment Record",
        key: "staff_consignment_record",
        icon: staff_consignmentIcon,
      },
      {
        name: "Customer Consignment Record",
        key: "customer_consignment_record",
        icon: consignmentRecordIcon,
      },
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
        return <Staff_Consignment />;
      case "staff_consignment_record":
        return <Staff_Consignment_Record />;
      case "customer_consignment_record":
        return <Customer_Consignment_Record />;
      default:
        return <Staff_Dashboard />;
    }
  };

  const handleLogout = (): void => {
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
    <IonPage className={`staff-shell-page ${isMenuCollapsed ? "sidebar-collapsed" : ""}`}>
      <IonSplitPane
        contentId="main"
        when="(min-width: 768px)"
        className={`staff-split-pane ${isMenuCollapsed ? "is-collapsed" : ""}`}
      >
        <IonMenu
          contentId="main"
          type="reveal"
          className={`staff-menu ${isMenuCollapsed ? "collapsed" : ""}`}
        >
          <IonHeader className="staff-menu-header">
            <IonToolbar>
              <div className={`menu-brand ${isMenuCollapsed ? "collapsed" : ""}`}>
                <button
                  type="button"
                  className="sidebar-toggle-btn"
                  onClick={() => setIsMenuCollapsed((prev) => !prev)}
                  aria-label={isMenuCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  title={isMenuCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  <span />
                  <span />
                  <span />
                </button>

                <img src={studyHubLogo} alt="Study Hub" className="menu-logo" />

                {!isMenuCollapsed && (
                  <span className="menu-title-text figma-title">Me Tyme Lounge</span>
                )}
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

            <motion.div
              className="menu-items-layer"
              variants={listVariants}
              initial="hidden"
              animate="show"
            >
              {menuItems.map((item) => (
                <IonMenuToggle key={item.key} autoHide={false}>
                  <motion.div variants={itemVariants} whileHover={{ x: isMenuCollapsed ? 0 : 3 }}>
                    <IonItem
                      button
                      lines="none"
                      className={`menu-item ${activePage === item.key ? "active" : ""} ${
                        isMenuCollapsed ? "menu-item-collapsed" : ""
                      }`}
                      onClick={() => setActivePage(item.key)}
                      title={item.name}
                    >
                      <img src={item.icon} alt={item.name} className="menu-icon" />
                      {!isMenuCollapsed && <span className="menu-text">{item.name}</span>}
                    </IonItem>
                  </motion.div>
                </IonMenuToggle>
              ))}

              <IonMenuToggle autoHide={false}>
                <motion.div variants={itemVariants}>
                  <IonButton
                    className={`logout-btn ${isMenuCollapsed ? "logout-btn-collapsed" : ""}`}
                    onClick={handleLogout}
                    title="Logout"
                  >
                    <IonIcon icon={logOutOutline} slot="start" />
                    {!isMenuCollapsed && "Logout"}
                  </IonButton>
                </motion.div>
              </IonMenuToggle>
            </motion.div>
          </IonContent>
        </IonMenu>

        <div id="main" className={`staff-main-shell ${isMenuCollapsed ? "expanded" : ""}`}>
          <IonHeader>
            <IonToolbar className="staff-topbar">
              <IonButtons slot="start">
                <IonMenuButton />
              </IonButtons>

              <span className="topbar-title">Staff Dashboard</span>

              <IonButtons slot="end">
                <div className="topbar-tools">
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

          {notifOpen && (
            <div
              className="notif-popover notif-popover--fixed"
              style={{ top: `${popoverPos.top}px`, right: `${popoverPos.right}px` }}
              role="dialog"
              aria-label="Notifications"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="notif-popover-head">
                <div>
                  <div className="notif-title">Guest Messages</div>
                  <div className="notif-subtitle">
                    Anonymous / guest concern, feedback, suggestion, request
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="notif-close-btn"
                    onClick={closeBell}
                    aria-label="Close"
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="notif-popover-body">
                {notifLoading ? (
                  <div className="notif-empty">
                    <IonSpinner name="dots" />
                  </div>
                ) : notifItems.length === 0 ? (
                  <div className="notif-empty">No messages yet.</div>
                ) : (
                  notifItems.map((n) => {
                    const typeValue = normalizeType(n.report_type);

                    return (
                      <div
                        key={n.id}
                        className={`notif-chat-item ${n.is_read ? "" : "notif-chat-item--unread"}`}
                      >
                        <div className="notif-avatar">{getAvatarText(n.name)}</div>

                        <div className="notif-main">
                          <div className="notif-topline">
                            <div className="notif-name">{n.name || "Guest User"}</div>
                            <div className="notif-datetime">{formatPHDateTime(n.created_at)}</div>
                          </div>

                          <div className="notif-meta">
                            <span className={`notif-type-pill notif-type-pill--${typeValue}`}>
                              {getTypeLabel(typeValue)}
                            </span>
                            <span className="notif-seat-pill">
                              Seat: {n.seat_number || "-"}
                            </span>
                          </div>

                          <div className="notif-message">{getMessageText(n)}</div>

                          <div className="notif-actions">
                            <button
                              type="button"
                              className="notif-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteNotification(n.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
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
