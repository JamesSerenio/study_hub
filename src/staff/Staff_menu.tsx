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
  IonTitle,
  IonToolbar,
  IonIcon,
} from "@ionic/react";
import { logOutOutline } from "ionicons/icons";
import { useHistory } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

// Page
import Staff_Dashboard from "./Staff_Dashboard";

// Icon
import dashboardIcon from "../assets/add_user.png";

const Staff_menu: React.FC = () => {
  const history = useHistory();
  const [activePage, setActivePage] = useState<string>("dashboard");

  const menuItems = [
    { name: "Dashboard", key: "dashboard", icon: dashboardIcon },
  ];

  const renderContent = () => {
    if (activePage === "dashboard") return <Staff_Dashboard />;
    return <h2>Welcome Staff</h2>;
  };

  const listVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.15 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -30 },
    show: { opacity: 1, x: 0 },
  };

  const handleLogout = () => {
    // Clear any session or user data
    localStorage.clear();
    sessionStorage.clear();
    setActivePage("dashboard"); // reset menu state
    history.push("/login");      // navigate to login page
  };

  return (
    <IonPage>
      <IonSplitPane contentId="main" when="(min-width: 768px)">
        {/* Sidebar */}
        <IonMenu contentId="main" className="staff-menu">
          <IonHeader>
            <IonToolbar>
              <IonTitle>👤 Staff Menu</IonTitle>
            </IonToolbar>
          </IonHeader>

          <IonContent>
            <motion.div
              variants={listVariants}
              initial="hidden"
              animate="show"
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              {menuItems.map((item, index) => (
                <motion.div key={index} variants={itemVariants}>
                  <IonMenuToggle autoHide={false}>
                    <IonItem
                      button
                      onClick={() => setActivePage(item.key)}
                      lines="none"
                      className={activePage === item.key ? "active" : ""}
                    >
                      <img
                        src={item.icon}
                        alt={item.name}
                        style={{ width: 24, marginRight: 12 }}
                      />
                      {item.name}
                    </IonItem>
                  </IonMenuToggle>
                </motion.div>
              ))}

              {/* Logout */}
              <motion.div variants={itemVariants} style={{ marginTop: 20 }}>
                <IonMenuToggle autoHide={false}>
                  <IonButton expand="block" color="danger" onClick={handleLogout}>
                    <IonIcon icon={logOutOutline} slot="start" />
                    Logout
                  </IonButton>
                </IonMenuToggle>
              </motion.div>
            </motion.div>
          </IonContent>
        </IonMenu>

        {/* Main Content */}
        <IonPage id="main">
          <IonHeader>
            <IonToolbar>
              <IonButtons slot="start">
                <IonMenuButton />
              </IonButtons>
              <IonTitle>Staff Dashboard</IonTitle>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            <AnimatePresence mode="wait">
              <motion.div
                key={activePage}
                initial={{ opacity: 0, y: 25 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -25 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
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
