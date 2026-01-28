// Admin_Add_Ons.tsx
import React, { useEffect, useRef, useState } from "react";
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
  IonPopover,
  IonList,
  IonText,
} from "@ionic/react";
import type { IonInputCustomEvent, InputChangeEventDetail } from "@ionic/core";
import { supabase } from "../utils/supabaseClient";

type Profile = { role: string };

const normalizeCategory = (v: string): string =>
  v.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const Admin_Add_Ons: React.FC = () => {
  const [category, setCategory] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [restocked, setRestocked] = useState<number | undefined>(undefined);
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [expenses, setExpenses] = useState<number>(0);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // ✅ Category suggestions (ONLY show when category is EMPTY)
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState<boolean>(false);
  const CAT_TRIGGER_ID = "category-trigger";
  const pickingRef = useRef<boolean>(false);

  useEffect(() => {
    const loadCategories = async (): Promise<void> => {
      const { data, error } = await supabase
        .from("add_ons")
        .select("category")
        .not("category", "is", null);

      if (error) {
        console.error("Load categories error:", error);
        return;
      }

      const unique: string[] = Array.from(
        new Set(
          (data ?? [])
            .map((r: { category?: string | null }) => (r.category ?? "").trim())
            .filter((c) => c.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b));

      setAllCategories(unique);
    };

    void loadCategories();
  }, []);

  // ✅ HARD GUARANTEE: if category becomes NON-empty, close the popover
  useEffect(() => {
    if (category.trim() !== "" && catOpen) {
      setCatOpen(false);
      pickingRef.current = false;
    }
  }, [category, catOpen]);

  const openIfEmpty = (): void => {
    // ✅ only open when empty
    if (category.trim() === "") {
      setCatOpen(true);
    } else {
      setCatOpen(false);
    }
  };

  const closePopover = (): void => {
    pickingRef.current = false;
    setCatOpen(false);
  };

  const handlePickCategory = (picked: string): void => {
    setCategory(picked); // useEffect will also close, but we close immediately too
    closePopover();
  };

  const handleAddOnSubmit = async (): Promise<void> => {
    if (!category || !name || restocked === undefined || price === undefined) {
      setToastMessage("Please fill in all required fields!");
      setShowToast(true);
      return;
    }

    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user) throw new Error("Not logged in");

      const userId: string = userRes.user.id;

      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single<Profile>();

      if (profErr) throw profErr;
      if (!profile || profile.role !== "admin") throw new Error("Admin only");

      let imageUrl: string | null = null;

      if (imageFile) {
        const extRaw: string | undefined = imageFile.name.split(".").pop();
        const fileExt: string = (extRaw ? extRaw.toLowerCase() : "jpg").trim();
        const fileName: string = `${Date.now()}.${fileExt}`;
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

      const categoryFinal = normalizeCategory(category);

      const { error: insertErr } = await supabase.from("add_ons").insert([
        {
          admin_id: userId,
          category: categoryFinal,
          name: name.trim(),
          restocked,
          price,
          expenses,
          image_url: imageUrl,
        },
      ]);

      if (insertErr) throw insertErr;

      // ✅ update local category list if new
      setAllCategories((prev) => {
        if (prev.some((c) => c.toLowerCase() === categoryFinal.toLowerCase()))
          return prev;
        return [...prev, categoryFinal].sort((a, b) => a.localeCompare(b));
      });

      // reset
      setCategory("");
      setName("");
      setRestocked(undefined);
      setPrice(undefined);
      setExpenses(0);
      setImageFile(null);
      closePopover();

      setToastMessage("Add-on added successfully!");
      setShowToast(true);
    } catch (err: unknown) {
      console.error(err);
      setToastMessage(
        err instanceof Error ? err.message : "Unexpected error occurred"
      );
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
        {/* ✅ CATEGORY: suggestions ONLY when EMPTY */}
        <IonItem id={CAT_TRIGGER_ID}>
          <IonLabel position="stacked">Category</IonLabel>
          <IonInput
            value={category}
            placeholder="Tap to choose category"
            onIonFocus={openIfEmpty}
            onClick={openIfEmpty}
            onIonInput={(e: IonInputCustomEvent<InputChangeEventDetail>) => {
              const v = (e.detail.value ?? "").toString();
              setCategory(v);

              // ✅ if user typed anything -> close and never show unless cleared
              if (v.trim() !== "") closePopover();
            }}
          />
        </IonItem>

        <IonPopover
          trigger={CAT_TRIGGER_ID}
          // ✅ SUPER IMPORTANT: open only if BOTH (catOpen) AND (category is EMPTY)
          isOpen={catOpen && category.trim() === ""}
          keepContentsMounted
          side="bottom"
          alignment="start"
          onDidDismiss={() => {
            if (pickingRef.current) return;
            closePopover();
          }}
        >
          <IonContent className="ion-padding">
            <IonText style={{ fontSize: 13, opacity: 0.8 }}>
              Suggestions (tap to select)
            </IonText>

            <IonList>
              {allCategories.slice(0, 8).map((c) => (
                <IonItem
                  key={c}
                  button
                  onPointerDown={() => {
                    pickingRef.current = true;
                  }}
                  onClick={() => handlePickCategory(c)}
                >
                  <IonLabel>{c}</IonLabel>
                </IonItem>
              ))}
            </IonList>
          </IonContent>
        </IonPopover>

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

        <IonButton
          expand="block"
          className="ion-margin-top"
          onClick={handleAddOnSubmit}
        >
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
