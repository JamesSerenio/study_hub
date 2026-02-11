// src/pages/Staff_Consignment.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  IonSelect,
  IonSelectOption,
} from "@ionic/react";
import type { IonInputCustomEvent, InputChangeEventDetail } from "@ionic/core";
import { chevronDownOutline, imageOutline, addCircleOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

type Profile = { role: string };

type AddOnSize = "None" | "XS" | "S" | "M" | "L" | "XL" | "2XL" | "3XL" | "4XL" | "5XL";
const SIZE_OPTIONS: AddOnSize[] = ["None", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

const normalizeSize = (v: string): string => v.trim();
const normalizeText = (v: string): string => v.trim().replace(/\s+/g, " ");

type CategoryRow = { id: string };

const Staff_Consignment: React.FC = () => {
  const [fullName, setFullName] = useState<string>("");
  const [itemName, setItemName] = useState<string>("");
  const [size, setSize] = useState<AddOnSize>("None");

  const [restocked, setRestocked] = useState<number | undefined>(undefined);
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // ✅ Popover suggestions for FULL NAME
  const [allFullNames, setAllFullNames] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState<boolean>(false);
  const [catEvent, setCatEvent] = useState<MouseEvent | undefined>(undefined);
  const iconBtnRef = useRef<HTMLButtonElement | null>(null);

  // ✅ category_id must be the addon_categories row where name='Consignment'
  const [consignmentCategoryId, setConsignmentCategoryId] = useState<string | null>(null);

  useEffect(() => {
    const loadPrereqs = async (): Promise<void> => {
      // 1) Find category_id of addon_categories where name='Consignment'
      const { data: catRow, error: catErr } = await supabase
        .from("addon_categories")
        .select("id")
        .ilike("name", "Consignment")
        .limit(1);

      if (catErr) {
        console.error("Load addon_categories error:", catErr);
        setToastMessage("Failed to load addon_categories.");
        setShowToast(true);
      } else {
        const id: string | null = (catRow?.[0] as CategoryRow | undefined)?.id ?? null;
        setConsignmentCategoryId(id);
      }

      // 2) load full name suggestions from existing consignment rows
      const { data, error } = await supabase.from("consignment").select("full_name").not("full_name", "is", null);

      if (error) {
        console.error("Load full names error:", error);
        return;
      }

      const unique: string[] = Array.from(
        new Set(
          (data ?? [])
            .map((r: { full_name?: string | null }) => (r.full_name ?? "").trim())
            .filter((c) => c.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b));

      setAllFullNames(unique);
    };

    void loadPrereqs();
  }, []);

  const shownNames = useMemo(() => allFullNames.slice(0, 30), [allFullNames]);

  const closePopover = (): void => {
    setCatOpen(false);
    setCatEvent(undefined);
  };

  const onDropdownClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setCatEvent(e.nativeEvent);
    setCatOpen(true);
  };

  const handlePickFullName = (picked: string): void => {
    setFullName(picked);
    requestAnimationFrame(() => closePopover());
  };

  const handleSubmit = async (): Promise<void> => {
    if (!fullName || !itemName || restocked === undefined || price === undefined) {
      setToastMessage("Please fill in all required fields!");
      setShowToast(true);
      return;
    }

    if (!consignmentCategoryId) {
      setToastMessage("Consignment category not found. Run: insert into addon_categories(name) values ('Consignment');");
      setShowToast(true);
      return;
    }

    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user) throw new Error("Not logged in");

      const userId: string = userRes.user.id;

      // ✅ allow BOTH admin & staff
      const { data: profile, error: profErr } = await supabase.from("profiles").select("role").eq("id", userId).single<Profile>();
      if (profErr) throw profErr;

      const role = (profile?.role ?? "").toLowerCase();
      if (role !== "admin" && role !== "staff") throw new Error("Admin/Staff only");

      let imageUrl: string | null = null;

      // ✅ upload to bucket: consignment
      if (imageFile) {
        const extRaw: string | undefined = imageFile.name.split(".").pop();
        const fileExt: string = (extRaw ? extRaw.toLowerCase() : "jpg").trim();
        const fileName: string = `${Date.now()}.${fileExt}`;
        const filePath: string = `${userId}/${fileName}`;

        const { error: uploadError } = await supabase.storage.from("consignment").upload(filePath, imageFile, {
          contentType: imageFile.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("consignment").getPublicUrl(filePath);
        imageUrl = urlData.publicUrl;
      }

      const fullNameFinal = normalizeText(fullName);
      const itemNameFinal = normalizeText(itemName);

      const sizeFinal = normalizeSize(size);
      const sizeDb: string | null = sizeFinal === "None" ? null : sizeFinal;

      // ✅ 1) insert to consignment
      const { error: insertConsErr } = await supabase.from("consignment").insert([
        {
          created_by: userId,
          category_id: consignmentCategoryId,
          full_name: fullNameFinal,
          item_name: itemNameFinal,
          size: sizeDb,
          restocked,
          price,
          image_url: imageUrl,
        },
      ]);

      if (insertConsErr) throw insertConsErr;

      // ✅ 2) ALSO insert to add_ons so it appears under category = "Consignment"
      const { error: insertAddOnErr } = await supabase.from("add_ons").insert([
        {
          admin_id: userId, // staff/admin id (ok)
          category: "Consignment",
          category_id: consignmentCategoryId,
          name: itemNameFinal,
          size: sizeDb,
          restocked,
          price,
          image_url: imageUrl,
        },
      ]);

      if (insertAddOnErr) throw insertAddOnErr;

      // update suggestions list
      setAllFullNames((prev) => {
        if (prev.some((n) => n.toLowerCase() === fullNameFinal.toLowerCase())) return prev;
        return [...prev, fullNameFinal].sort((a, b) => a.localeCompare(b));
      });

      setFullName("");
      setItemName("");
      setSize("None");
      setRestocked(undefined);
      setPrice(undefined);
      setImageFile(null);
      closePopover();

      setToastMessage("Consignment item added (also added to Add-Ons > Consignment)!");
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
      <IonHeader className="aao-header"></IonHeader>

      <IonContent className="aao-content">
        <div className="aao-wrap">
          <div className="aao-card">
            <div className="aao-card-head">
              <div>
                <div className="aao-card-title">Add Consignment Item</div>
                <div className="aao-card-sub">Fill the details below to add a consignment product</div>
              </div>
            </div>

            <div className="aao-grid">
              {/* LEFT */}
              <div className="aao-col aao-col-left">
                {/* FULL NAME */}
                <IonItem className="aao-item" lines="none">
                  <IonLabel position="stacked" className="aao-label">
                    Full Name <span className="aao-req">*</span>
                  </IonLabel>

                  <div className="aao-field aao-field--withIcon">
                    <IonInput
                      className="aao-input"
                      value={fullName}
                      placeholder="Tap to choose full name"
                      onIonInput={(e: IonInputCustomEvent<InputChangeEventDetail>) => {
                        const v = (e.detail.value ?? "").toString();
                        setFullName(v);
                      }}
                      onIonFocus={() => {
                        if (catOpen) closePopover();
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />

                    <button
                      ref={iconBtnRef}
                      type="button"
                      className="aao-dropbtn"
                      aria-label="Open full name suggestions"
                      onClick={onDropdownClick}
                    >
                      <IonIcon className="aao-field-icon aao-field-icon--click" icon={chevronDownOutline} />
                    </button>
                  </div>
                </IonItem>

                {/* POPOVER */}
                <IonPopover
                  isOpen={catOpen}
                  event={catEvent}
                  onDidDismiss={closePopover}
                  side="bottom"
                  alignment="start"
                  className="aao-popover"
                  showBackdrop={false}
                >
                  <IonContent className="aao-popover-content">
                    <IonText className="aao-popover-hint">Suggestions (tap to select)</IonText>

                    <div className="aao-popover-scroll">
                      <IonList className="aao-popover-list">
                        {shownNames.map((n) => (
                          <IonItem key={n} button className="aao-popover-item" onClick={() => handlePickFullName(n)}>
                            <IonLabel className="aao-popover-label">{n}</IonLabel>
                          </IonItem>
                        ))}
                      </IonList>
                    </div>
                  </IonContent>
                </IonPopover>

                {/* SIZE */}
                <IonItem className="aao-item" lines="none">
                  <IonLabel position="stacked" className="aao-label">
                    Size <span className="aao-opt">(optional)</span>
                  </IonLabel>

                  <div className="aao-field">
                    <IonSelect
                      className="aao-input"
                      value={size}
                      interface="popover"
                      placeholder="None"
                      onIonChange={(e) => setSize((e.detail.value ?? "None") as AddOnSize)}
                    >
                      {SIZE_OPTIONS.map((opt) => (
                        <IonSelectOption key={opt} value={opt}>
                          {opt}
                        </IonSelectOption>
                      ))}
                    </IonSelect>
                  </div>

                  <div className="aao-help">Choose size if applicable. If not, keep None.</div>
                </IonItem>

                {/* ITEM NAME */}
                <IonItem className="aao-item" lines="none">
                  <IonLabel position="stacked" className="aao-label">
                    Item Name <span className="aao-req">*</span>
                  </IonLabel>
                  <div className="aao-field">
                    <IonInput
                      className="aao-input"
                      value={itemName}
                      placeholder="Example: Nike Shoes"
                      onIonChange={(e) => setItemName((e.detail.value ?? "").toString())}
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
              </div>

              {/* RIGHT */}
              <div className="aao-col aao-col-right">
                <div className="aao-rightCard">
                  <div className="aao-rightTitle">Pricing & Stock</div>
                  <div className="aao-rightSub">Set quantity & price here</div>

                  <IonItem className="aao-item aao-item-compact" lines="none">
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

                  <IonItem className="aao-item aao-item-compact" lines="none">
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

                  <IonButton className="aao-btn aao-btn--primary aao-btn-right" expand="block" onClick={handleSubmit}>
                    <IonIcon slot="start" icon={addCircleOutline} />
                    Add Consignment
                  </IonButton>

                  <div className="aao-footnote aao-footnote-right">
                    Tip: Full name suggestions will appear when you tap the dropdown icon.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <IonToast isOpen={showToast} message={toastMessage} duration={2000} onDidDismiss={() => setShowToast(false)} />
      </IonContent>
    </IonPage>
  );
};

export default Staff_Consignment;
