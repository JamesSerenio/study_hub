// src/admin/Admin_menu.tsx
import React, { useEffect, useMemo, useState } from "react";
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
} from "@ionic/react";
import { logOutOutline } from "ionicons/icons";
import { useHistory } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

/* ================= PAGES ================= */
import Admin_Dashboard from "./Admin_Dashboard";
import Admin_Add_Ons from "./Admin_Add_Ons";
import Admin_Item_Lists from "./Admin_Item_Lists";
import Admin_customer_list from "./Admin_customer_list";
import Admin_customer_reservation from "./Admin_customer_reservation";
import Admin_Packages from "./Admin_Packages";
import Admin_Customer_Discount_List from "./Admin_Customer_Discount_List";
import Admin_Seat_Table from "./Admin_Seat_Table";
import Admin_Staff_Expenses_Expired from "./Admin_Staff_Expenses&Expired";
import Admin_Customer_Add_ons from "./Admin_Customer_Add_ons";
import Admin_Sales_Report from "./Admin_Sales_Report";
import Admin_Restock_Record from "./Admin_Restock_Record";
import Admin_Customer_Cancelled from "./Admin_Customer_Cancelled";
import Staff_Consignment_Record from "./Admin_Staff_Consignment_Record";
import Customer_Consignment_Record from "./Admin_Customer_Consignment_Record";
import Admin_Consignment_Approval from "./Admin_Consignment_Approval";

/* ================= ASSETS ================= */
import dashboardIcon from "../assets/graph.png";
import addOnsIcon from "../assets/ons.png";
import itemIcon from "../assets/item.png";
import customerListIcon from "../assets/list.png";
import reservationIcon from "../assets/reserve.png";
import promotionIcon from "../assets/promotion.png";
import discountIcon from "../assets/discount.png";
import seatIcon from "../assets/seat.png";
import expenseIcon from "../assets/expense.png";
import hamburgerIcon from "../assets/hamburger.png";
import salesIcon from "../assets/sales.png";
import restockIcon from "../assets/restock.png";
import cancelledIcon from "../assets/cancelled.png";
import studyHubLogo from "../assets/study_hub.png";
import flowerImg from "../assets/flower.png";
import staff_consignmentIcon from "../assets/staff_consignment.png";
import customerConsignmentIcon from "../assets/consignment_record.png";
import approvedIcon from "../assets/approved.png";

type MenuKey =
  | "dashboard"
  | "add_ons"
  | "item_lists"
  | "restock_records"
  | "staff_expenses"
  | "sales_report"
  | "customer_add_ons"
  | "customer_list"
  | "customer_reservation"
  | "customer_cancelled"
  | "seat_table"
  | "packages"
  | "discount_records"
  | "staff_consignment_record"
  | "customer_consignment_record"
  | "consignment_approval";

type MenuItem = {
  name: string;
  key: MenuKey;
  icon: string;
};

type FlowerStatic = {
  id: string;
  left: string;
  top: string;
  size: string;
  opacity: number;
  rotateDeg?: number;
};

const Admin_menu: React.FC = () => {
  const history = useHistory();
  const [activePage, setActivePage] = useState<MenuKey>("dashboard");
  const [boot, setBoot] = useState(false);

  /* ✅ collapse sidebar */
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setBoot(true);
      window.dispatchEvent(new Event("resize"));
      document.body.getBoundingClientRect();
    }, 0);

    return () => window.clearTimeout(t);
  }, []);

  const menuItems: MenuItem[] = useMemo(
    () => [
      { name: "Dashboard", key: "dashboard", icon: dashboardIcon },
      { name: "Admin Add Ons", key: "add_ons", icon: addOnsIcon },
      { name: "Item Lists", key: "item_lists", icon: itemIcon },
      { name: "Restock Records", key: "restock_records", icon: restockIcon },
      { name: "Staff Expenses & Cash outs", key: "staff_expenses", icon: expenseIcon },
      { name: "Sales Report", key: "sales_report", icon: salesIcon },
      { name: "Customer Add-Ons", key: "customer_add_ons", icon: hamburgerIcon },
      { name: "Customer List", key: "customer_list", icon: customerListIcon },
      { name: "Customer Reservations", key: "customer_reservation", icon: reservationIcon },
      { name: "Cancelled Records", key: "customer_cancelled", icon: cancelledIcon },
      { name: "Consignment Record", key: "staff_consignment_record", icon: staff_consignmentIcon },
      { name: "Customer Consignment Record", key: "customer_consignment_record", icon: customerConsignmentIcon },
      { name: "Consignment Approval", key: "consignment_approval", icon: approvedIcon },
      { name: "Seat Table", key: "seat_table", icon: seatIcon },
      { name: "Promotions", key: "packages", icon: promotionIcon },
      { name: "Memberships", key: "discount_records", icon: discountIcon },
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

  const renderContent = (): React.ReactNode => {
    switch (activePage) {
      case "dashboard":
        return <Admin_Dashboard />;
      case "add_ons":
        return <Admin_Add_Ons />;
      case "item_lists":
        return <Admin_Item_Lists />;
      case "restock_records":
        return <Admin_Restock_Record />;
      case "staff_expenses":
        return <Admin_Staff_Expenses_Expired />;
      case "sales_report":
        return <Admin_Sales_Report />;
      case "customer_add_ons":
        return <Admin_Customer_Add_ons />;
      case "customer_list":
        return <Admin_customer_list />;
      case "customer_reservation":
        return <Admin_customer_reservation />;
      case "customer_cancelled":
        return <Admin_Customer_Cancelled />;
      case "staff_consignment_record":
        return <Staff_Consignment_Record />;
      case "customer_consignment_record":
        return <Customer_Consignment_Record />;
      case "consignment_approval":
        return <Admin_Consignment_Approval />;
      case "seat_table":
        return <Admin_Seat_Table />;
      case "packages":
        return <Admin_Packages />;
      case "discount_records":
        return <Admin_Customer_Discount_List />;
      default:
        return <Admin_Dashboard />;
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
        {/* ================= SIDEBAR ================= */}
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

                <img src={studyHubLogo} alt="Me Tyme Lounge" className="menu-logo" />

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

            <motion.div className="menu-items-layer" variants={listVariants} initial="hidden" animate="show">
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

        {/* ================= MAIN ================= */}
        <div id="main" className={`staff-main-shell ${isMenuCollapsed ? "expanded" : ""}`}>
          <IonHeader>
            <IonToolbar className="staff-topbar">
              <IonButtons slot="start">
                <IonMenuButton />
              </IonButtons>

              <span className="topbar-title">Admin Panel</span>
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
        </div>
      </IonSplitPane>
    </IonPage>
  );
};

export default Admin_menu;