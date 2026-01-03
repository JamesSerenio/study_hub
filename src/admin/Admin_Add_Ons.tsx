// Admin_Add_Ons.tsx
import React, { useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonToast,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

const Admin_Add_Ons: React.FC = () => {
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [restocked, setRestocked] = useState<number | undefined>();
  const [price, setPrice] = useState<number | undefined>();
  const [expenses, setExpenses] = useState<number | undefined>(0);
  const [imageUrl, setImageUrl] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const handleAddOnSubmit = async () => {
    if (!category || !name || restocked === undefined || price === undefined) {
      setToastMessage("Please fill in all required fields!");
      setShowToast(true);
      return;
    }

    try {
      const { error } = await supabase.from("add_ons").insert([
        {
          category,
          name,
          restocked,
          price,
          expenses: expenses || 0,
          image_url: imageUrl,
        },
      ]);

      if (error) {
        setToastMessage("Error adding item: " + error.message);
        setShowToast(true);
        return;
      }

      setCategory("");
      setName("");
      setRestocked(undefined);
      setPrice(undefined);
      setExpenses(0);
      setImageUrl("");
      setToastMessage("Add-on added successfully!");
      setShowToast(true);
    } catch (err) {
      console.error(err);
      setToastMessage("Unexpected error occurred");
      setShowToast(true);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Admin Add-Ons</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Category */}
        <IonItem>
          <IonLabel position="stacked">Category</IonLabel>
          <IonInput
            placeholder="Type category"
            value={category}
            onIonChange={(e) => setCategory(e.detail.value!)}
          />
        </IonItem>

        {/* Name */}
        <IonItem>
          <IonLabel position="stacked">Item Name</IonLabel>
          <IonInput
            placeholder="Type item name"
            value={name}
            onIonChange={(e) => setName(e.detail.value!)}
          />
        </IonItem>

        {/* Image URL */}
        <IonItem>
          <IonLabel position="stacked">Image URL</IonLabel>
          <IonInput
            placeholder="Enter image URL (optional)"
            value={imageUrl}
            onIonChange={(e) => setImageUrl(e.detail.value!)}
          />
        </IonItem>

        {/* Restocked */}
        <IonItem>
          <IonLabel position="stacked">Restocked Quantity</IonLabel>
          <IonInput
            type="number"
            placeholder="Enter restocked quantity"
            value={restocked}
            onIonChange={(e) => setRestocked(Number(e.detail.value))}
          />
        </IonItem>

        {/* Price */}
        <IonItem>
          <IonLabel position="stacked">Price</IonLabel>
          <IonInput
            type="number"
            placeholder="Enter price"
            value={price}
            onIonChange={(e) => setPrice(Number(e.detail.value))}
          />
        </IonItem>

        {/* Expenses */}
        <IonItem>
          <IonLabel position="stacked">Expenses</IonLabel>
          <IonInput
            type="number"
            placeholder="Enter expenses (optional)"
            value={expenses}
            onIonChange={(e) => setExpenses(Number(e.detail.value))}
          />
        </IonItem>

        <IonButton expand="block" className="ion-margin-top" onClick={handleAddOnSubmit}>
          Add Add-On
        </IonButton>

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

export default Admin_Add_Ons;