// src/pages/Admin_menu.tsx

import React, { useState } from "react";
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

/* ================= PAGES ================= */
import Admin_Dashboard from "./Admin_Dashboard";
import Admin_Add_Ons from "./Admin_Add_Ons";
import Admin_Item_Lists from "./Admin_Item_Lists";
import Admin_customer_list from "./Admin_customer_list";
import Admin_customer_reservation from "./Admin_customer_reservation";
import Admin_Packages from "./Admin_Packages";
import Admin_Customer_Discount_List from "./Admin_Customer_Discount_List";
import Admin_Seat_Table from "./Admin_Seat_Table";
import Admin_Staff_Expenses_Expired from "./Admin_Staff_Expenses_Expired"; // ✅ ADD

/* ================= ASSETS ================= */
import dashboardIcon from "../assets/graph.png";
import addOnsIcon from "../assets/ons.png";
import itemIcon from "../assets/item.png";
import customerListIcon from "../assets/list.png";
import reservationIcon from "../assets/reserve.png";
import promotionIcon from "../assets/promotion.png";
import discountIcon from "../assets/discount.png";
import seatIcon from "../assets/seat.png";
import expenseIcon from "../assets/expense.png"; // ✅ ADD
import studyHubLogo from "../assets/study_hub.png";

type MenuKey =
  | "dashboard"
  | "add_ons"
  | "item_lists"
  | "staff_expenses"
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

const Admin_menu: React.FC = () => {
  const history = useHistory();
  const [activePage, setActivePage] = useState<MenuKey>("dashboard");

  const menuItems: MenuItem[] = [
    { name: "Dashboard", key: "dashboard", icon: dashboardIcon },
    { name: "Admin Add Ons", key: "add_ons", icon: addOnsIcon },
    { name: "Item Lists", key: "item_lists", icon: itemIcon },

    // ✅ NEW PAGE
    { name: "Staff Expenses", key: "staff_expenses", icon: expenseIcon },

    { name: "Customer List", key: "customer_list", icon: customerListIcon },
    { name: "Customer Reservations", key: "customer_reservation", icon: reservationIcon },

    // ✅ ADMIN SEAT TABLE
    { name: "Seat Table", key: "seat_table", icon: seatIcon },

    // ✅ PROMOS
    { name: "Promotions", key: "packages", icon: promotionIcon },

    // ✅ DISCOUNT RECORDS
    { name: "Discount Records", key: "discount_records", icon: discountIcon },
  ];

  const renderContent = (): React.ReactNode => {
    switch (activePage) {
      case "dashboard":
        return <Admin_Dashboard />;

      case "add_ons":
        return <Admin_Add_Ons />;

      case "item_lists":
        return <Admin_Item_Lists />;

      case "staff_expenses":
        return <Admin_Staff_Expenses_Expired />;

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
        return <h2>Welcome Admin</h2>;
    }
  };

  const handleLogout = (): void => {
    localStorage.clear();
    sessionStorage.clear();
    history.push("/login");
  };

  return (
    <IonPage>
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

          <IonContent>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              {menuItems.map((item) => (
                <IonMenuToggle key={item.key} autoHide={false}>
                  <IonItem
                    button
                    lines="none"
                    className={`menu-item ${activePage === item.key ? "active" : ""}`}
                    onClick={() => setActivePage(item.key)}
                  >
                    <img src={item.icon} alt={item.name} className="menu-icon" />
                    <span className="menu-text">{item.name}</span>
                  </IonItem>
                </IonMenuToggle>
              ))}

              {/* LOGOUT */}
              <IonMenuToggle autoHide={false}>
                <IonButton className="logout-btn" onClick={handleLogout}>
                  <IonIcon icon={logOutOutline} slot="start" />
                  Logout
                </IonButton>
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
              <span className="topbar-title">Admin Panel</span>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding custom-bg">
            <AnimatePresence mode="wait">
              <motion.div
                key={activePage}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
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

export default Admin_menu;
