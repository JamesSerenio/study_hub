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
import Admin_Dashboard from "./Admin_Dashboard";
import Admin_Add_Ons from "./Admin_Add_Ons";

/* Assets */
import dashboardIcon from "../assets/graph.png";
import addOnsIcon from "../assets/ons.png";
import studyHubLogo from "../assets/study_hub.png";

const Admin_menu: React.FC = () => {
  const history = useHistory();
  const [activePage, setActivePage] = useState("dashboard");

  const menuItems = [
    { name: "Dashboard", key: "dashboard", icon: dashboardIcon },
    { name: "Admin Add Ons", key: "add_ons", icon: addOnsIcon },
  ];

  const renderContent = () => {
    switch (activePage) {
      case "dashboard":
        return <Admin_Dashboard />;
      case "add_ons":
        return <Admin_Add_Ons />;
      default:
        return <h2>Welcome Admin</h2>;
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
          
          {/* HEADER */}
          <IonHeader className="staff-menu-header">
            <IonToolbar>
              <div className="menu-brand">
                <img
                  src={studyHubLogo}
                  alt="Me Tyme Lounge"
                  className="menu-logo"
                />
                <span className="menu-title-text figma-title">
                  Me Tyme Lounge
                </span>
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
                    className={`menu-item ${
                      activePage === item.key ? "active" : ""
                    }`}
                    onClick={() => setActivePage(item.key)}
                  >
                    <img
                      src={item.icon}
                      alt={item.name}
                      className="menu-icon"
                    />
                    {item.name}
                  </IonItem>
                </IonMenuToggle>
              ))}

              {/* LOGOUT */}
              <IonMenuToggle autoHide={false}>
                <IonButton
                  expand="block"
                  color="danger"
                  className="logout-btn"
                  onClick={handleLogout}
                >
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

          <IonContent className="ion-padding">
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
