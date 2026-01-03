// Admin_Item_Lists.tsx
import React, { useState, useEffect } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

interface AddOn {
  id: string;
  category: string;
  item_name: string;
  restocked: number;
  price: number;
}

const Admin_Item_Lists: React.FC = () => {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const fetchAddOns = async () => {
    try {
      const { data, error } = await supabase
        .from("add_ons")
        .select("*")
        .order("created_at", { ascending: false }); // Assuming there's a created_at column; adjust if not

      if (error) {
        throw error;
      }

      setAddOns(data || []);
    } catch (error) {
      console.error("Error fetching add-ons:", error);
      setToastMessage("Error loading add-ons. Please try again.");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAddOns();
  }, []);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>) => {
    fetchAddOns().then(() => {
      event.detail.complete();
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Admin Item Lists</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {loading ? (
          <IonLabel>Loading add-ons...</IonLabel>
        ) : (
          <IonList>
            {addOns.length > 0 ? (
              addOns.map((addOn) => (
                <IonItem key={addOn.id}>
                  <IonLabel>
                    <h2>{addOn.item_name}</h2>
                    <p>Category: {addOn.category}</p>
                    <p>Restocked: {addOn.restocked}</p>
                    <p>Price: ₱{addOn.price.toFixed(2)}</p>
                  </IonLabel>
                  {/* Add edit/delete buttons if needed */}
                  {/* <IonButton slot="end" fill="clear" onClick={() => handleEdit(addOn.id)}>Edit</IonButton> */}
                  {/* <IonButton slot="end" fill="clear" color="danger" onClick={() => handleDelete(addOn.id)}>Delete</IonButton> */}
                </IonItem>
              ))
            ) : (
              <IonItem>
                <IonLabel>No add-ons found.</IonLabel>
              </IonItem>
            )}
          </IonList>
        )}

        <IonToast
          isOpen={showToast}
          message={toastMessage}
          duration={2000}
          onDidDismiss={() => setShowToast(false)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Admin_Item_Lists;