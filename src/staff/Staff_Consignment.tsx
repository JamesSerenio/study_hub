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
const normalizeItemName = (v: string): string => v.trim().replace(/\s+/g, " ");

type CategoryRow = { id: string };

const Staff_Consignment: React.FC = () => {
  // ✅ UI NOTE:
  // "Category" field in Admin_Add_Ons becomes "Full Name" here (per your request).
  // Still uses same classnames so CSS stays consistent.

  const [fullName, setFullName] = useState<string>(""); // replaces category UI
  const [itemName, setItemName] = useState<string>("");
  const [size, setSize] = useState<AddOnSize>("None");

  const [restocked, setRestocked] = useState<number | undefined>(undefined);
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // ✅ Popover suggestions (same UX as Admin_Add_Ons)
  const [allFullNames, setAllFullNames] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState<boolean>(false);
  const [catEvent, setCatEvent] = useState<MouseEvent | undefined>(undefined);
  const iconBtnRef = useRef<HTMLButtonElement | null>(null);

  // category_id source:
  // if addon_categories has rows, we will use the first one.
  // If none exists, we will show error to create at least 1 category.
  const [categoryId, setCategoryId] = useState<string | null>(null);

  useEffect(() => {
    const loadPrereqs = async (): Promise<void> => {
      // 1) pick a category_id (first available)
      const { data: cats, error: catErr } = await supabase.from("addon_categories").select("id").limit(1);

      if (catErr) {
        console.error("Load addon_categories error:", catErr);
        setToastMessage("Failed to load categories (addon_categories).");
        setShowToast(true);
        return;
      }

      const firstId: string | null = (cats?.[0] as CategoryRow | undefined)?.id ?? null;
      setCategoryId(firstId);

      // 2) load full name suggestions from existing consignment rows
      const { data, error } = await supabase
        .from("consignment")
        .select("full_name")
        .not("full_name", "is", null);

      if (error) {
        console.error("Load full names error:", error);
        // not fatal
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

    if (!categoryId) {
      setToastMessage("No category found. Please add at least 1 row in addon_categories.");
      setShowToast(true);
      return;
    }

    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userRes?.user) throw new Error("Not logged in");

      const userId: string = userRes.user.id;

      // ✅ allow BOTH admin & staff
      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single<Profile>();

      if (profErr) throw profErr;

      const role = (profile?.role ?? "").toLowerCase();
      if (role !== "admin" && role !== "staff") throw new Error("Admin/Staff only");

      let imageUrl: string | null = null;

      if (imageFile) {
        const extRaw: string | undefined = imageFile.name.split(".").pop();
        const fileExt: string = (extRaw ? extRaw.toLowerCase() : "jpg").trim();
        const fileName: string = `${Date.now()}.${fileExt}`;
        const filePath: string = `${userId}/${fileName}`;

        // ✅ bucket name: consignment (as you created)
        const { error: uploadError } = await supabase.storage.from("consignment").upload(filePath, imageFile, {
          contentType: imageFile.type,
          upsert: false,
        });

        if (uploadError) throw uploadError;

        // Public bucket => public URL works for anon/customer
        const { data: urlData } = supabase.storage.from("consignment").getPublicUrl(filePath);
        imageUrl = urlData.publicUrl;
      }

      const fullNameFinal = normalizeItemName(fullName);
      const itemNameFinal = normalizeItemName(itemName);

      const sizeFinal = normalizeSize(size);
      const sizeDb: string | null = sizeFinal === "None" ? null : sizeFinal;

      const { error: insertErr } = await supabase.from("consignment").insert([
        {
          // created_by has default auth.uid() in table, but ok to include too
          created_by: userId,
          category_id: categoryId,
          full_name: fullNameFinal,
          item_name: itemNameFinal,
          size: sizeDb,
          restocked,
          price,
          image_url: imageUrl,
        },
      ]);

      if (insertErr) throw insertErr;

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

      setToastMessage("Consignment item added successfully!");
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
                {/* FULL NAME (replaces Category field UI) */}
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

                {/* ✅ POPOVER (full name suggestions) */}
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

                {/* SIZE (optional) */}
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
