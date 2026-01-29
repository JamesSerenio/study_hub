// src/pages/Staff_menu.tsx
import React, { useMemo, useState } from "react";
import {
  IonButtons,
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonMenu,
  IonMenuButton,
  IonMenuToggle,
  IonPage,
  IonSplitPane,
  IonToolbar,
  IonIcon,
} from "@ionic/react";
import { logOutOutline } from "ionicons/icons";
import { useHistory } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

/* ===================== PAGES ===================== */
import Staff_Dashboard from "./Staff_Dashboard";
import Customer_Lists from "./Customer_Lists";
import Customer_Reservations from "./Customer_Reservations";
import Customer_Calendar from "./Customer_Calendar";
import Product_Item_Lists from "./Product_Item_lists";
import Customer_Add_ons from "./Customer_Add_ons";
import Customer_Discount_List from "./Customer_Discount_List";
import Staff_Sales_Report from "./Staff_Sales_Report";

/* ===================== ASSETS ===================== */
import dashboardIcon from "../assets/add_user.png";
import studyHubLogo from "../assets/study_hub.png";
import listIcon from "../assets/list.png";
import reserveIcon from "../assets/reserve.png";
import calendarIcon from "../assets/calendar.png";
import foodIcon from "../assets/food.png";
import onsIcon from "../assets/hamburger.png";
import discountIcon from "../assets/discount.png";
import salesIcon from "../assets/sales.png";

/* 🌼 STATIC flower background */
import flowerImg from "../assets/flower.png";

type FlowerStatic = {
  id: string;
  left: string; // css value
  top: string;  // css value
  size: string; // px
  opacity: number;
  rotateDeg?: number;
};

const Staff_menu: React.FC = () => {
  const history = useHistory();
  const [activePage, setActivePage] = useState("dashboard");

  /* ===================== MENU ITEMS ===================== */
  const menuItems = useMemo(
    () => [
      { name: "Dashboard", key: "dashboard", icon: dashboardIcon },
      { name: "Customer Lists", key: "customer_lists", icon: listIcon },
      { name: "Customer Reservations", key: "customer_reservations", icon: reserveIcon },
      { name: "Customer Calendar", key: "customer_calendar", icon: calendarIcon },
      { name: "Customer Add-Ons", key: "customer_add_ons", icon: onsIcon },
      { name: "Customer Discount List", key: "customer_discount_list", icon: discountIcon },
      { name: "Sales Report", key: "staff_sales_report", icon: salesIcon },
      { name: "Product Item Lists", key: "product_item_lists", icon: foodIcon },
    ],
    []
  );

  /* ===================== STATIC FLOWERS (NO APPEAR/DISAPPEAR) ===================== */
  const flowers: FlowerStatic[] = useMemo(
    () => [
      // ✅ BIG flower top-right (like your sample)
      { id: "big-tr", left: "62%", top: "10%", size: "260px", opacity: 0.18, rotateDeg: 0 },

      // ✅ BIG flower bottom-left
      { id: "big-bl", left: "-10%", top: "70%", size: "320px", opacity: 0.16, rotateDeg: 0 },

      // ✅ small flowers scattered
      { id: "s1", left: "58%", top: "52%", size: "110px", opacity: 0.18, rotateDeg: 0 },
      { id: "s2", left: "73%", top: "62%", size: "95px", opacity: 0.18, rotateDeg: 0 },
      { id: "s3", left: "64%", top: "74%", size: "105px", opacity: 0.18, rotateDeg: 0 },
      { id: "s4", left: "78%", top: "78%", size: "90px", opacity: 0.18, rotateDeg: 0 },
      { id: "s5", left: "54%", top: "86%", size: "85px", opacity: 0.16, rotateDeg: 0 },
    ],
    []
  );

  /* ===================== RENDER CONTENT ===================== */
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
      case "customer_discount_list":
        return <Customer_Discount_List />;
      case "staff_sales_report":
        return <Staff_Sales_Report />;
      case "product_item_lists":
        return <Product_Item_Lists />;
      default:
        return <Staff_Dashboard />;
    }
  };

  /* ===================== LOGOUT ===================== */
  const handleLogout = () => {
    localStorage.clear();
    sessionStorage.clear();
    history.push("/login");
  };

  /* ===================== MENU ANIMATION ===================== */
  const listVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -12 },
    show: { opacity: 1, x: 0, transition: { duration: 0.22 } },
  };

  return (
    <IonPage>
      <IonSplitPane contentId="main" when="(min-width: 768px)">
        {/* ================= SIDEBAR ================= */}
        <IonMenu contentId="main" className="staff-menu">
          <IonHeader className="staff-menu-header">
            <IonToolbar>
              <div className="menu-brand">
                <img src={studyHubLogo} alt="Study Hub" className="menu-logo" />
                <span className="menu-title-text figma-title">Me Tyme Lounge</span>
              </div>
            </IonToolbar>
          </IonHeader>

          {/* ✅ IMPORTANT: overflow hidden container */}
          <IonContent className="staff-menu-content">
            {/* ✅ STATIC FLOWERS LAYER (BACKGROUND) */}
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

            {/* MENU ITEMS (ABOVE FLOWERS) */}
            <motion.div
              className="menu-items-layer"
              variants={listVariants}
              initial="hidden"
              animate="show"
            >
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

              {/* LOGOUT */}
              <IonMenuToggle autoHide={false}>
                <motion.div variants={itemVariants} whileHover={{ scale: 1.02 }}>
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
        <IonPage id="main">
          <IonHeader>
            <IonToolbar>
              <IonButtons slot="start">
                <IonMenuButton />
              </IonButtons>
              <span className="topbar-title">Staff Dashboard</span>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding custom-bg">
            <AnimatePresence mode="wait">
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
          </IonContent>
        </IonPage>
      </IonSplitPane>
    </IonPage>
  );
};

export default Staff_menu;
