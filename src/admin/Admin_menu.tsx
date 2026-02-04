// src/admin/Admin_menu.tsx
// ✅ SAME CLASSNAMES AS Staff_menu
// ✅ STATIC flowers
// ✅ Keeps your existing pages/files/menu items
// ✅ VERCEL FIX: boot + resize/reflow so dashboard shows immediately after login

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
import studyHubLogo from "../assets/study_hub.png";
import flowerImg from "../assets/flower.png";

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
  | "seat_table"
  | "packages"
  | "discount_records";

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

  // ✅ VERCEL FIRST-LOAD FIX (same as staff)
  const [boot, setBoot] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setBoot(true);
      window.dispatchEvent(new Event("resize"));
      document.body.getBoundingClientRect(); // reflow
    }, 0);

    return () => window.clearTimeout(t);
  }, []);

  const menuItems: MenuItem[] = useMemo(
    () => [
      { name: "Dashboard", key: "dashboard", icon: dashboardIcon },
      { name: "Admin Add Ons", key: "add_ons", icon: addOnsIcon },
      { name: "Item Lists", key: "item_lists", icon: itemIcon },
      { name: "Restock Records", key: "restock_records", icon: restockIcon },
      { name: "Staff Expenses", key: "staff_expenses", icon: expenseIcon },
      { name: "Sales Report", key: "sales_report", icon: salesIcon },
      { name: "Customer Add-Ons", key: "customer_add_ons", icon: hamburgerIcon },
      { name: "Customer List", key: "customer_list", icon: customerListIcon },
      { name: "Customer Reservations", key: "customer_reservation", icon: reservationIcon },
      { name: "Seat Table", key: "seat_table", icon: seatIcon },
      { name: "Promotions", key: "packages", icon: promotionIcon },
      { name: "Discount Records", key: "discount_records", icon: discountIcon },
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
    <IonPage className="staff-shell-page">
      <IonSplitPane contentId="main" when="(min-width: 768px)">
        {/* ================= SIDEBAR ================= */}
        <IonMenu contentId="main" className="staff-menu">
          <IonHeader className="staff-menu-header">
            <IonToolbar>
              <div className="menu-brand">
                <img src={studyHubLogo} alt="Me Tyme Lounge" className="menu-logo" />
                <span className="menu-title-text figma-title">Me Tyme Lounge</span>
              </div>
            </IonToolbar>
          </IonHeader>

          <IonContent className="staff-menu-content">
            {/* flowers background */}
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

            {/* menu items */}
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

              {/* logout */}
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

        {/* ================= MAIN ================= */}
        <div id="main" className="staff-main-shell">
          <IonHeader>
            <IonToolbar>
              <IonButtons slot="start">
                <IonMenuButton />
              </IonButtons>
              <span className="topbar-title">Admin Panel</span>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding custom-bg">
            {/* ✅ render after boot so Vercel shows immediately */}
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
