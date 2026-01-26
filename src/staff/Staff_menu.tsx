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

/* Pages */
import Staff_Dashboard from "./Staff_Dashboard";
import Customer_Lists from "./Customer_Lists";
import Customer_Reservations from "./Customer_Reservations";
import Customer_Calendar from "./Customer_Calendar";
import Product_Item_Lists from "./Product_Item_lists";
import Customer_Add_ons from "./Customer_Add_ons";
import Customer_Discount_List from "./Customer_Discount_List";

/* Assets */
import dashboardIcon from "../assets/add_user.png";
import studyHubLogo from "../assets/study_hub.png";
import listIcon from "../assets/list.png";
import reserveIcon from "../assets/reserve.png";
import calendarIcon from "../assets/calendar.png";
import foodIcon from "../assets/food.png";
import onsIcon from "../assets/hamburger.png";
import discountIcon from "../assets/discount.png";

const Staff_menu: React.FC = () => {
  const history = useHistory();
  const [activePage, setActivePage] = useState("dashboard");

  const menuItems = [
    { name: "Dashboard", key: "dashboard", icon: dashboardIcon },
    { name: "Customer Lists", key: "customer_lists", icon: listIcon },
    { name: "Customer Reservations", key: "customer_reservations", icon: reserveIcon },
    { name: "Customer Calendar", key: "customer_calendar", icon: calendarIcon },
    { name: "Customer Add-Ons", key: "customer_add_ons", icon: onsIcon },
    { name: "Customer Discount List", key: "customer_discount_list", icon: discountIcon },
    { name: "Product Item Lists", key: "product_item_lists", icon: foodIcon },
  ];

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
      case "product_item_lists":
        return <Product_Item_Lists />;
      default:
        return <h2>Welcome Staff</h2>;
    }
  };

  const handleLogout = () => {
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
                <img src={studyHubLogo} alt="Study Hub" className="menu-logo" />
                <span className="menu-title-text figma-title">Me Tyme Lounge</span>
              </div>
            </IonToolbar>
          </IonHeader>

          <IonContent>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
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
              <span className="topbar-title">Staff Dashboard</span>
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

export default Staff_menu;
