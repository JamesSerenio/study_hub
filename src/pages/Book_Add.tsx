import React from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonGrid,
  IonRow,
  IonCol,
} from "@ionic/react";
import { useHistory } from "react-router-dom";

const Book_Add: React.FC = () => {
  const history = useHistory();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Book / Add-Ons</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonGrid>
          <IonRow>
            {/* LEFT BUTTON */}
            <IonCol size="6" className="ion-text-left">
              <IonButton
                expand="block"
                onClick={() => history.push("/add-ons")}
              >
                Add_Ons
              </IonButton>
            </IonCol>

            {/* RIGHT BUTTON */}
            <IonCol size="6" className="ion-text-right">
              <IonButton
                expand="block"
                onClick={() => history.push("/booking")}
              >
                Booking
              </IonButton>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonPage>
  );
};

export default Book_Add;
