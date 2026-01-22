import React from "react";
import {
  IonPage,
  IonHeader,
  IonContent,
} from "@ionic/react";

import seatsImage from "../assets/seats.png";

const Staff_Dashboard: React.FC = () => {
  return (
    <IonPage>
      <IonHeader>
      </IonHeader>

      <IonContent fullscreen className="staff-content">
        <div className="staff-wrapper">
          <div className="staff-card">

            {/* ✅ SEATS IMAGE ONLY */}
            <div className="seat-image-wrap">
              <img
                src={seatsImage}
                alt="Seat Map"
                className="seat-image"
              />
            </div>

          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Staff_Dashboard;
