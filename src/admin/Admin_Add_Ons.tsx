// src/pages/Admin_Add_Ons.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonToast,
  IonPopover,
  IonList,
  IonText,
  IonIcon,
} from "@ionic/react";
import type { IonInputCustomEvent, InputChangeEventDetail } from "@ionic/core";
import { chevronDownOutline, imageOutline, addCircleOutline } from "ionicons/icons";
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
  const CAT_TRIGGER_ID = "aao-category-trigger";
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
    if (category.trim() === "") setCatOpen(true);
    else setCatOpen(false);
  };

  const closePopover = (): void => {
    pickingRef.current = false;
    setCatOpen(false);
  };

  const handlePickCategory = (picked: string): void => {
    setCategory(picked);
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

        const { data: urlData } = supabase.storage.from("add-ons").getPublicUrl(filePath);
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

      setAllCategories((prev) => {
        if (prev.some((c) => c.toLowerCase() === categoryFinal.toLowerCase())) return prev;
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
      setToastMessage(err instanceof Error ? err.message : "Unexpected error occurred");
      setShowToast(true);
    }
  };

  const fileLabel = imageFile ? imageFile.name : "Choose image (optional)";

  return (
    <IonPage className="aao-page">
      <IonHeader className="aao-header">
      </IonHeader>

      <IonContent className="aao-content">
        <div className="aao-wrap">
          <div className="aao-card">
            <div className="aao-card-head">
              <div>
                <div className="aao-card-title">Add New Product</div>
                <div className="aao-card-sub">Fill the details below to add an add-on item</div>
              </div>
            </div>

            <div className="aao-form">
              {/* ✅ CATEGORY: suggestions ONLY when EMPTY */}
              <IonItem id={CAT_TRIGGER_ID} className="aao-item" lines="none">
                <IonLabel position="stacked" className="aao-label">
                  Category <span className="aao-req">*</span>
                </IonLabel>

                <div className="aao-field aao-field--withIcon">
                  <IonInput
                    className="aao-input"
                    value={category}
                    placeholder="Tap to choose category"
                    onIonFocus={openIfEmpty}
                    onClick={openIfEmpty}
                    onIonInput={(e: IonInputCustomEvent<InputChangeEventDetail>) => {
                      const v = (e.detail.value ?? "").toString();
                      setCategory(v);

                      if (v.trim() !== "") closePopover();
                    }}
                  />
                  <IonIcon className="aao-field-icon" icon={chevronDownOutline} />
                </div>
              </IonItem>

              <IonPopover
                trigger={CAT_TRIGGER_ID}
                isOpen={catOpen && category.trim() === ""}
                keepContentsMounted
                side="bottom"
                alignment="start"
                className="aao-popover"
                onDidDismiss={() => {
                  if (pickingRef.current) return;
                  closePopover();
                }}
              >
                <IonContent className="aao-popover-content">
                  <IonText className="aao-popover-hint">Suggestions (tap to select)</IonText>

                  <IonList className="aao-popover-list">
                    {allCategories.slice(0, 10).map((c) => (
                      <IonItem
                        key={c}
                        button
                        className="aao-popover-item"
                        onPointerDown={() => {
                          pickingRef.current = true;
                        }}
                        onClick={() => handlePickCategory(c)}
                      >
                        <IonLabel className="aao-popover-label">{c}</IonLabel>
                      </IonItem>
                    ))}
                  </IonList>
                </IonContent>
              </IonPopover>

              <IonItem className="aao-item" lines="none">
                <IonLabel position="stacked" className="aao-label">
                  Item Name <span className="aao-req">*</span>
                </IonLabel>
                <div className="aao-field">
                  <IonInput
                    className="aao-input"
                    value={name}
                    placeholder="Example: Choco Syrup"
                    onIonChange={(e) => setName((e.detail.value ?? "").toString())}
                  />
                </div>
              </IonItem>

              {/* IMAGE */}
              <IonItem className="aao-item" lines="none">
                <IonLabel position="stacked" className="aao-label">
                  Image
                </IonLabel>

                <label className="aao-file">
                  <IonIcon icon={imageOutline} className="aao-file-icon" />
                  <span className="aao-file-text">{fileLabel}</span>
                  <input
                    className="aao-file-input"
                    type="file"
                    accept="image/*"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const fileList: FileList | null = e.target.files;
                      setImageFile(fileList && fileList.length > 0 ? fileList[0] : null);
                    }}
                  />
                </label>

                <div className="aao-help">Tip: image is optional. You can add later too.</div>
              </IonItem>

              <div className="aao-twoCol">
                <IonItem className="aao-item" lines="none">
                  <IonLabel position="stacked" className="aao-label">
                    Restocked Quantity <span className="aao-req">*</span>
                  </IonLabel>
                  <div className="aao-field">
                    <IonInput
                      className="aao-input"
                      inputMode="numeric"
                      type="number"
                      value={restocked}
                      placeholder="e.g. 50"
                      onIonChange={(e) => {
                        const v: string = (e.detail.value ?? "").toString();
                        setRestocked(v === "" ? undefined : Number(v));
                      }}
                    />
                  </div>
                </IonItem>

                <IonItem className="aao-item" lines="none">
                  <IonLabel position="stacked" className="aao-label">
                    Price <span className="aao-req">*</span>
                  </IonLabel>
                  <div className="aao-field">
                    <IonInput
                      className="aao-input"
                      inputMode="decimal"
                      type="number"
                      value={price}
                      placeholder="e.g. 25"
                      onIonChange={(e) => {
                        const v: string = (e.detail.value ?? "").toString();
                        setPrice(v === "" ? undefined : Number(v));
                      }}
                    />
                  </div>
                </IonItem>
              </div>

              <IonItem className="aao-item" lines="none">
                <IonLabel position="stacked" className="aao-label">
                  Expenses
                </IonLabel>
                <div className="aao-field">
                  <IonInput
                    className="aao-input"
                    type="number"
                    inputMode="decimal"
                    value={expenses}
                    placeholder="0"
                    onIonChange={(e) => {
                      const v: string = (e.detail.value ?? "").toString();
                      setExpenses(v === "" ? 0 : Number(v));
                    }}
                  />
                </div>
              </IonItem>

              <IonButton className="aao-btn aao-btn--primary" expand="block" onClick={handleAddOnSubmit}>
                <IonIcon slot="start" icon={addCircleOutline} />
                Add Add-On
              </IonButton>

              <div className="aao-footnote">
                Tip: Category suggestions will only appear when the category field is empty.
              </div>
            </div>
          </div>
        </div>

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
