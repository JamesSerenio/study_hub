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

// ✅ ADMIN DASHBOARD
import Admin_Dashboard from "./Admin_Dashboard";

// Icon (palitan ng add_user.png)
import adminIcon from "../assets/add_user.png";

const Admin_menu: React.FC = () => {
  const history = useHistory();
  const [activePage, setActivePage] = useState<string>("dashboard");

  const renderContent = () => {
    switch (activePage) {
      case "dashboard":
        return <Admin_Dashboard />;
      default:
        return <h2>Admin Dashboard</h2>;
    }
  };

  return (
    <IonPage>
      <IonSplitPane contentId="main">
        {/* SIDE MENU */}
        <IonMenu contentId="main" className="admin-menu">
          <IonHeader>
            <IonToolbar>
              <IonTitle>🛠 Admin Menu</IonTitle>
            </IonToolbar>
          </IonHeader>

          <IonContent>
            {/* DASHBOARD */}
            <IonMenuToggle autoHide={false}>
              <IonItem
                button
                lines="none"
                onClick={() => setActivePage("dashboard")}
                className={activePage === "dashboard" ? "active" : ""}
              >
                <img
                  src={adminIcon}
                  alt="Admin Dashboard"
                  style={{ width: 24, marginRight: 12 }}
                />
                Admin Dashboard
              </IonItem>
            </IonMenuToggle>

            {/* LOGOUT */}
            <IonMenuToggle autoHide={false}>
              <IonButton
                expand="block"
                color="danger"
                style={{ margin: 16 }}
                onClick={() => history.push("/login")}
              >
                <IonIcon icon={logOutOutline} slot="start" />
                Logout
              </IonButton>
            </IonMenuToggle>
          </IonContent>
        </IonMenu>

        {/* MAIN CONTENT */}
        <IonPage id="main">
          <IonHeader>
            <IonToolbar>
              <IonButtons slot="start">
                <IonMenuButton />
              </IonButtons>
              <IonTitle>Admin Dashboard</IonTitle>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            {renderContent()}
          </IonContent>
        </IonPage>
      </IonSplitPane>
    </IonPage>
  );
};

export default Admin_menu;
