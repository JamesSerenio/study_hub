// Product_Item_Lists.tsx
import React, { useState, useEffect } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonLabel,
  IonButton,
  IonIcon,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
  IonImg,
} from "@ionic/react";
import { arrowUp, arrowDown } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

interface AddOn {
  id: string;
  category: string;
  name: string;
  price: number;
  restocked: number;
  sold: number;
  expenses: number;
  stocks: number;
  overall_sales: number;
  expected_sales: number;
  image_url: string;
}

const Product_Item_Lists: React.FC = () => {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const fetchAddOns = async () => {
    try {
      const { data, error } = await supabase
        .from("add_ons")
        .select("*")
        .order("created_at", { ascending: false });

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

  const sortedAddOns = [...addOns].sort((a, b) => {
    if (sortOrder === 'asc') {
      return a.category.localeCompare(b.category);
    } else {
      return b.category.localeCompare(a.category);
    }
  });

  const toggleSort = () => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Product Item Lists</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {loading ? (
          <IonLabel>Loading add-ons...</IonLabel>
        ) : (
          <>
            <IonButton fill="clear" onClick={toggleSort}>
              Sort by Category {sortOrder === 'asc' ? <IonIcon icon={arrowUp} /> : <IonIcon icon={arrowDown} />}
            </IonButton>
            <IonGrid>
              <IonRow>
                <IonCol>Image</IonCol>
                <IonCol>Name</IonCol>
                <IonCol>Category</IonCol>
                <IonCol>Price</IonCol>
                <IonCol>Restocked</IonCol>
                <IonCol>Sold</IonCol>
                <IonCol>Stocks</IonCol>
                <IonCol>Expenses</IonCol>
                <IonCol>Overall Sales</IonCol>
                <IonCol>Expected Sales</IonCol>
              </IonRow>
              {sortedAddOns.length > 0 ? (
                sortedAddOns.map((addOn) => (
                  <IonRow key={addOn.id}>
                    <IonCol>
                      {addOn.image_url ? (
                        <IonImg src={addOn.image_url} alt={addOn.name} style={{ width: '50px', height: '50px' }} />
                      ) : (
                        <IonLabel>No Image</IonLabel>
                      )}
                    </IonCol>
                    <IonCol>{addOn.name}</IonCol>
                    <IonCol>{addOn.category}</IonCol>
                    <IonCol>₱{addOn.price.toFixed(2)}</IonCol>
                    <IonCol>{addOn.restocked}</IonCol>
                    <IonCol>{addOn.sold}</IonCol>
                    <IonCol>{addOn.stocks}</IonCol>
                    <IonCol>₱{addOn.expenses.toFixed(2)}</IonCol>
                    <IonCol>₱{addOn.overall_sales.toFixed(2)}</IonCol>
                    <IonCol>₱{addOn.expected_sales.toFixed(2)}</IonCol>
                  </IonRow>
                ))
              ) : (
                <IonRow>
                  <IonCol size="12">No add-ons found.</IonCol>
                </IonRow>
              )}
            </IonGrid>
          </>
        )}

        <IonToast
          isOpen={showToast}
          message={toastMessage}
          duration={3000}
          onDidDismiss={() => setShowToast(false)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Product_Item_Lists;