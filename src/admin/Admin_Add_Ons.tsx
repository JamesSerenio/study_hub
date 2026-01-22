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

type Profile = {
  role: string;
};

const Admin_Add_Ons: React.FC = () => {
  const [category, setCategory] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [restocked, setRestocked] = useState<number | undefined>(undefined);
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [expenses, setExpenses] = useState<number>(0);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  const handleAddOnSubmit = async (): Promise<void> => {
    if (!category || !name || restocked === undefined || price === undefined) {
      setToastMessage("Please fill in all required fields!");
      setShowToast(true);
      return;
    }

    try {
      // 1) Must be logged in
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user) throw new Error("Not logged in");

      const userId: string = userRes.user.id;

      // 2) Must be admin (profiles.role = 'admin')
      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single<Profile>();

      if (profErr) throw profErr;
      if (!profile || profile.role !== "admin") {
        throw new Error("Admin only");
      }

      // 3) Upload image (admin-only storage policy)
      let imageUrl: string | null = null;

      if (imageFile) {
        const extRaw: string | undefined = imageFile.name.split(".").pop();
        const fileExt: string = (extRaw ? extRaw.toLowerCase() : "jpg").trim();
        const fileName: string = `${Date.now()}.${fileExt}`;

        // Recommended path: per-user folder
        const filePath: string = `${userId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("add-ons")
          .upload(filePath, imageFile, {
            contentType: imageFile.type,
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("add-ons")
          .getPublicUrl(filePath);

        imageUrl = urlData.publicUrl;
      }

      // 4) Insert row to add_ons (include admin_id to satisfy RLS)
      const { error: insertErr } = await supabase.from("add_ons").insert([
        {
          admin_id: userId,
          category,
          name,
          restocked,
          price,
          expenses,
          image_url: imageUrl,
        },
      ]);

      if (insertErr) throw insertErr;

      // Reset form
      setCategory("");
      setName("");
      setRestocked(undefined);
      setPrice(undefined);
      setExpenses(0);
      setImageFile(null);

      setToastMessage("Add-on added successfully!");
      setShowToast(true);
    } catch (err: unknown) {
      console.error(err);
      setToastMessage(err instanceof Error ? err.message : "Unexpected error occurred");
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
        <IonItem>
          <IonLabel position="stacked">Category</IonLabel>
          <IonInput
            value={category}
            onIonChange={(e) => setCategory((e.detail.value ?? "").toString())}
          />
        </IonItem>

        <IonItem>
          <IonLabel position="stacked">Item Name</IonLabel>
          <IonInput
            value={name}
            onIonChange={(e) => setName((e.detail.value ?? "").toString())}
          />
        </IonItem>

        <IonItem>
          <IonLabel position="stacked">Image</IonLabel>
          <input
            type="file"
            accept="image/*"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const fileList: FileList | null = e.target.files;
              setImageFile(fileList && fileList.length > 0 ? fileList[0] : null);
            }}
          />
        </IonItem>

        <IonItem>
          <IonLabel position="stacked">Restocked Quantity</IonLabel>
          <IonInput
            type="number"
            value={restocked}
            onIonChange={(e) => {
              const v: string = (e.detail.value ?? "").toString();
              setRestocked(v === "" ? undefined : Number(v));
            }}
          />
        </IonItem>

        <IonItem>
          <IonLabel position="stacked">Price</IonLabel>
          <IonInput
            type="number"
            value={price}
            onIonChange={(e) => {
              const v: string = (e.detail.value ?? "").toString();
              setPrice(v === "" ? undefined : Number(v));
            }}
          />
        </IonItem>

        <IonItem>
          <IonLabel position="stacked">Expenses</IonLabel>
          <IonInput
            type="number"
            value={expenses}
            onIonChange={(e) => {
              const v: string = (e.detail.value ?? "").toString();
              setExpenses(v === "" ? 0 : Number(v));
            }}
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
