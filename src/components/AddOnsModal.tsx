import React, { useEffect, useMemo, useState } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonList,
  IonListHeader,
  IonSearchbar,
  IonThumbnail,
  IonImg,
  IonText,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

interface AddOn {
  id: string;
  category: string;
  size: string | null;
  name: string;
  price: number;
  restocked: number;
  sold: number;
  expenses: number;
  stocks: number;
  overall_sales: number;
  expected_sales: number;
  image_url: string | null;
}

interface SelectedAddOn {
  id: string;
  name: string;
  category: string;
  size: string | null;
  price: number;
  quantity: number;
  image_url: string | null;
}

type SeatGroup = { title: string; seats: string[] };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  seatGroups: SeatGroup[];
};

type RpcItem = { add_on_id: string; quantity: number };

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const norm = (s: string): string => s.trim().toLowerCase();
const cleanSize = (s: string | null | undefined): string => (s ?? "").trim();

export default function AddOnsModal({ isOpen, onClose, onSaved, seatGroups }: Props) {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const [addOnsFullName, setAddOnsFullName] = useState<string>("");
  const [addOnsSeat, setAddOnsSeat] = useState<string>("");

  const [selectedCategories, setSelectedCategories] = useState<string[]>([""]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([""]);
  const [selectedAddOns, setSelectedAddOns] = useState<SelectedAddOn[]>([]);

  // ✅ Item Picker modal states
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [pickerCategory, setPickerCategory] = useState<string>("");
  const [pickerSize, setPickerSize] = useState<string>("");
  const [pickerSearch, setPickerSearch] = useState<string>("");

  useEffect(() => {
    if (!isOpen) return;
    void fetchAddOns();

    setSelectedCategories((prev) => (prev.length === 0 ? [""] : prev));
    setSelectedSizes((prev) => (prev.length === 0 ? [""] : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fetchAddOns = async (): Promise<void> => {
    const { data, error } = await supabase
      .from("add_ons")
      .select("*")
      .gt("stocks", 0)
      .order("category", { ascending: true })
      .order("size", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert(`Error loading add-ons: ${error.message}`);
      return;
    }

    setAddOns((data as AddOn[]) || []);
  };

  const categories = useMemo(() => {
    const uniq = Array.from(new Set(addOns.map((a) => a.category).filter((c) => c.trim().length > 0)));
    uniq.sort((a, b) => a.localeCompare(b));
    return uniq;
  }, [addOns]);

  const addOnsTotal = useMemo<number>(
    () => selectedAddOns.reduce((sum, s) => sum + s.quantity * s.price, 0),
    [selectedAddOns]
  );

  const selectedSummaryByCategory = useMemo(() => {
    const map = new Map<string, SelectedAddOn[]>();
    for (const item of selectedAddOns) {
      const cat = item.category || "Uncategorized";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return Array.from(map.entries()).map(([category, items]) => ({
      category,
      items: items.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [selectedAddOns]);

  const stocksById = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of addOns) m.set(a.id, Math.max(0, Math.floor(toNum(a.stocks))));
    return m;
  }, [addOns]);

  const selectedQtyById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of selectedAddOns) {
      m.set(s.id, (m.get(s.id) ?? 0) + Math.max(0, Math.floor(toNum(s.quantity))));
    }
    return m;
  }, [selectedAddOns]);

  const getRemainingForId = (id: string): number => {
    const stocks = stocksById.get(id) ?? 0;
    const chosen = selectedQtyById.get(id) ?? 0;
    return Math.max(0, stocks - chosen);
  };

  const handleAddOnQuantityChange = (id: string, quantity: number): void => {
    const wanted = Math.max(0, Math.floor(quantity));

    setSelectedAddOns((prev) => {
      const existing = prev.find((s) => s.id === id);
      const addOn = addOns.find((a) => a.id === id);
      const stocks = Math.max(0, Math.floor(toNum(stocksById.get(id) ?? addOn?.stocks ?? 0)));

      const currentQty = existing ? Math.max(0, Math.floor(toNum(existing.quantity))) : 0;
      const chosenTotalSameId = prev
        .filter((s) => s.id === id)
        .reduce((sum, s) => sum + Math.max(0, Math.floor(toNum(s.quantity))), 0);

      const chosenOtherSameId = Math.max(0, chosenTotalSameId - currentQty);
      const maxAllowedForThis = Math.max(0, stocks - chosenOtherSameId);
      const q = Math.min(wanted, maxAllowedForThis);

      if (wanted > maxAllowedForThis) alert(`Only ${maxAllowedForThis} remaining for this item.`);

      if (q > 0) {
        if (existing) return prev.map((s) => (s.id === id ? { ...s, quantity: q } : s));
        if (!addOn) return prev;

        return [
          ...prev,
          {
            id,
            name: addOn.name,
            category: addOn.category,
            size: addOn.size,
            price: addOn.price,
            quantity: q,
            image_url: addOn.image_url ?? null,
          },
        ];
      }

      return prev.filter((s) => s.id !== id);
    });
  };

  const handleCategoryChange = (index: number, category: string): void => {
    setSelectedCategories((prev) => {
      const next = [...prev];
      next[index] = category;
      return next;
    });

    setSelectedSizes((prev) => {
      const next = [...prev];
      next[index] = "";
      return next;
    });
  };

  const handleSizeChange = (index: number, size: string): void => {
    setSelectedSizes((prev) => {
      const next = [...prev];
      next[index] = size;
      return next;
    });
  };

  const removeCategoryBlock = (index: number): void => {
    setSelectedCategories((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [""] : next;
    });

    setSelectedSizes((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [""] : next;
    });
  };

  const addAnotherCategory = (): void => {
    setSelectedCategories((prev) => [...prev, ""]);
    setSelectedSizes((prev) => [...prev, ""]);
  };

  const resetAddOnsForm = (): void => {
    setAddOnsFullName("");
    setAddOnsSeat("");
    setSelectedAddOns([]);
    setSelectedCategories([""]);
    setSelectedSizes([""]);
    setPickerSearch("");
    setPickerCategory("");
    setPickerSize("");
    setIsPickerOpen(false);
  };

  const getSizesForCategory = (category: string): string[] => {
    if (!category) return [];
    const sizes = addOns
      .filter((a) => a.category === category)
      .map((a) => cleanSize(a.size))
      .filter((s) => s.length > 0);

    const uniq = Array.from(new Set(sizes));
    const order = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
    uniq.sort((a, b) => {
      const ia = order.indexOf(a.toUpperCase());
      const ib = order.indexOf(b.toUpperCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return uniq;
  };

  const categoryHasSizes = (category: string): boolean => getSizesForCategory(category).length > 0;

  const pickerItems = useMemo(() => {
    const cat = pickerCategory;
    const hasSizes = categoryHasSizes(cat);
    const size = pickerSize.trim();
    const q = pickerSearch.trim().toLowerCase();

    return addOns
      .filter((a) => (cat ? a.category === cat : false))
      .filter((a) => {
        if (!hasSizes) return true;
        return norm(cleanSize(a.size)) === norm(size);
      })
      .map((a) => ({ ...a, remaining: getRemainingForId(a.id) }))
      .filter((a) => a.remaining > 0)
      .filter((a) => {
        if (!q) return true;
        return a.name.toLowerCase().includes(q);
      });
  }, [addOns, pickerCategory, pickerSize, pickerSearch, selectedAddOns]);

  const openPicker = (category: string, size: string): void => {
    setPickerCategory(category);
    setPickerSize(size);
    setPickerSearch("");
    setIsPickerOpen(true);
  };

  const addFromPicker = (addOn: AddOn): void => {
    const remaining = getRemainingForId(addOn.id);
    if (remaining <= 0) {
      alert("No remaining stock for this item.");
      return;
    }

    setSelectedAddOns((prev) => {
      const existing = prev.find((s) => s.id === addOn.id);
      if (existing) return prev;
      return [
        ...prev,
        {
          id: addOn.id,
          name: addOn.name,
          category: addOn.category,
          size: addOn.size,
          price: addOn.price,
          quantity: 1,
          image_url: addOn.image_url ?? null,
        },
      ];
    });

    setIsPickerOpen(false);
  };

  // ✅ FIXED: use RPC so it works on Vercel (RLS-safe)
  const handleSubmitAddOns = async (): Promise<void> => {
    const name = addOnsFullName.trim();
    if (!name) return alert("Full Name is required.");
    if (!addOnsSeat) return alert("Seat Number is required.");
    if (selectedAddOns.length === 0) return alert("Please select at least one add-on.");

    const items: RpcItem[] = selectedAddOns.map((s) => ({
      add_on_id: s.id,
      quantity: Math.max(1, Math.floor(toNum(s.quantity))),
    }));

    setIsSaving(true);
    try {
      const { error } = await supabase.rpc("place_addon_order", {
        p_full_name: name,
        p_seat_number: addOnsSeat,
        p_items: items,
      });

      if (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        alert(`Order failed: ${error.message}`);
        return;
      }

      await fetchAddOns();
      onSaved();
      resetAddOnsForm();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <IonModal isOpen={isOpen} onDidDismiss={onClose} className="booking-modal">
        <IonHeader>
          <IonToolbar>
            <IonTitle>Add-Ons</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={onClose}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>

        <IonContent className="ion-padding">
          <div className="bookadd-card">
            <IonItem className="form-item">
              <IonLabel position="stacked">Full Name *</IonLabel>
              <IonInput
                value={addOnsFullName}
                placeholder="Enter full name"
                onIonChange={(e) => setAddOnsFullName(e.detail.value ?? "")}
              />
            </IonItem>

            <IonItem className="form-item">
              <IonLabel position="stacked">Seat Number *</IonLabel>
              <IonSelect
                value={addOnsSeat}
                placeholder="Choose seat"
                onIonChange={(e) => setAddOnsSeat(asString(e.detail.value))}
              >
                {seatGroups.map((g) => (
                  <React.Fragment key={g.title}>
                    <IonSelectOption disabled value={`__${g.title}__`}>
                      {g.title}
                    </IonSelectOption>
                    {g.seats.map((s) => (
                      <IonSelectOption key={`${g.title}-${s}`} value={s}>
                        {s}
                      </IonSelectOption>
                    ))}
                  </React.Fragment>
                ))}
              </IonSelect>
            </IonItem>

            <IonButton expand="block" onClick={addAnotherCategory}>
              Add More Add-Ons
            </IonButton>

            {selectedCategories.map((category, index) => {
              const hasSizes = categoryHasSizes(category);
              const sizeOptions = hasSizes ? getSizesForCategory(category) : [];
              const pickedSize = (selectedSizes[index] ?? "").trim();
              const allowPick = category ? (hasSizes ? pickedSize.length > 0 : true) : false;

              return (
                <div key={`cat-${index}`} className="addon-block">
                  <div className="addon-row">
                    <IonItem className="form-item addon-flex">
                      <IonLabel position="stacked">Select Category {index + 1}</IonLabel>
                      <IonSelect
                        value={category}
                        placeholder="Choose a category"
                        onIonChange={(e) => handleCategoryChange(index, asString(e.detail.value))}
                      >
                        {categories.map((cat) => (
                          <IonSelectOption key={`${cat}-${index}`} value={cat}>
                            {cat}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonItem>

                    <IonButton color="danger" onClick={() => removeCategoryBlock(index)}>
                      x
                    </IonButton>
                  </div>

                  {category && hasSizes ? (
                    <IonItem className="form-item">
                      <IonLabel position="stacked">Select Size</IonLabel>
                      <IonSelect
                        value={pickedSize}
                        placeholder="Choose size"
                        onIonChange={(e) => handleSizeChange(index, asString(e.detail.value))}
                      >
                        {sizeOptions.map((sz) => (
                          <IonSelectOption key={`${category}-${sz}-${index}`} value={sz}>
                            {sz}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonItem>
                  ) : null}

                  {allowPick ? (
                    <IonButton expand="block" onClick={() => openPicker(category, hasSizes ? pickedSize : "")} style={{ marginTop: 8 }}>
                      Choose {category} Item{hasSizes ? ` (${pickedSize})` : ""}
                    </IonButton>
                  ) : category && hasSizes ? (
                    <IonItem className="form-item" lines="none">
                      <IonLabel style={{ opacity: 0.85 }}>Select a size first to show items.</IonLabel>
                    </IonItem>
                  ) : null}
                </div>
              );
            })}

            {/* SELECTED ITEMS LIST */}
            {selectedAddOns.length > 0 ? (
              <IonList style={{ marginTop: 12 }}>
                <IonListHeader>
                  <IonLabel>Selected Items</IonLabel>
                </IonListHeader>

                {selectedSummaryByCategory.map(({ category: catTitle, items }) => (
                  <React.Fragment key={catTitle}>
                    <IonListHeader>
                      <IonLabel>
                        <strong>{catTitle}</strong>
                      </IonLabel>
                    </IonListHeader>

                    {items.map((selected) => {
                      const stocks = Math.max(0, Math.floor(toNum(stocksById.get(selected.id) ?? 0)));
                      const remainingIfKeepQty = Math.max(0, stocks - selected.quantity);

                      return (
                        <IonItem key={selected.id} className="addon-item">
                          <IonThumbnail slot="start" style={{ width: 46, height: 46 }}>
                            {selected.image_url ? (
                              <IonImg src={selected.image_url} alt={selected.name} />
                            ) : (
                              <div style={{ width: 46, height: 46, borderRadius: 10, background: "#eee" }} />
                            )}
                          </IonThumbnail>

                          <IonLabel>
                            <div style={{ fontWeight: 700 }}>
                              {selected.name}{" "}
                              {cleanSize(selected.size) ? (
                                <span style={{ opacity: 0.85 }}>({cleanSize(selected.size)})</span>
                              ) : null}
                            </div>
                            <div style={{ opacity: 0.85 }}>₱{selected.price}</div>
                            <div style={{ marginTop: 4, fontWeight: 700 }}>
                              Subtotal: ₱{(selected.price * selected.quantity).toFixed(2)}
                            </div>
                            <div style={{ marginTop: 6, opacity: 0.9 }}>
                              Remaining after this qty: <strong>{remainingIfKeepQty}</strong>
                            </div>
                          </IonLabel>

                          <div className="addon-actions">
                            <IonLabel className="qty-label">Qty:</IonLabel>
                            <IonInput
                              type="number"
                              min={1}
                              value={selected.quantity}
                              className="qty-input"
                              onIonChange={(e) => {
                                const raw = (e.detail.value ?? "").toString();
                                const v = parseInt(raw, 10);
                                handleAddOnQuantityChange(selected.id, Number.isNaN(v) ? 0 : v);
                              }}
                            />

                            <IonButton color="danger" onClick={() => setSelectedAddOns((prev) => prev.filter((s) => s.id !== selected.id))}>
                              Remove
                            </IonButton>
                          </div>
                        </IonItem>
                      );
                    })}
                  </React.Fragment>
                ))}
              </IonList>
            ) : null}

            <div className="summary-section" style={{ marginTop: 12 }}>
              <p className="summary-text">
                <strong>Add-Ons Total: ₱{addOnsTotal.toFixed(2)}</strong>
              </p>
            </div>

            <IonButton expand="block" disabled={isSaving} onClick={() => void handleSubmitAddOns()}>
              {isSaving ? "Saving..." : "Submit Order"}
            </IonButton>

            <IonButton
              expand="block"
              fill="clear"
              onClick={() => {
                resetAddOnsForm();
                onClose();
              }}
              style={{ marginTop: 6 }}
            >
              Reset
            </IonButton>
          </div>
        </IonContent>
      </IonModal>

      {/* ✅ ITEM PICKER MODAL (with images) */}
      <IonModal isOpen={isPickerOpen} onDidDismiss={() => setIsPickerOpen(false)} className="booking-modal">
        <IonHeader>
          <IonToolbar>
            <IonTitle>
              Choose Item {pickerCategory ? `- ${pickerCategory}` : ""} {pickerSize ? `(${pickerSize})` : ""}
            </IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setIsPickerOpen(false)}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>

        <IonContent className="ion-padding">
          <IonSearchbar value={pickerSearch} onIonInput={(e) => setPickerSearch(asString(e.detail.value))} placeholder="Search item name..." />

          {pickerItems.length === 0 ? (
            <IonText style={{ opacity: 0.85 }}>
              <p>No available items.</p>
            </IonText>
          ) : (
            <IonList>
              {pickerItems.map((a) => {
                const remaining = getRemainingForId(a.id);

                return (
                  <IonItem key={a.id} button onClick={() => addFromPicker(a)}>
                    <IonThumbnail slot="start" style={{ width: 56, height: 56 }}>
                      {a.image_url ? (
                        <IonImg src={a.image_url} alt={a.name} />
                      ) : (
                        <div style={{ width: 56, height: 56, borderRadius: 10, background: "#eee" }} />
                      )}
                    </IonThumbnail>

                    <IonLabel>
                      <div style={{ fontWeight: 800 }}>{a.name}</div>
                      {cleanSize(a.size) ? <div style={{ opacity: 0.85 }}>Size: {cleanSize(a.size)}</div> : null}
                      <div style={{ marginTop: 4 }}>
                        ₱{toNum(a.price)} • Remaining: <strong>{remaining}</strong>
                      </div>
                    </IonLabel>
                  </IonItem>
                );
              })}
            </IonList>
          )}
        </IonContent>
      </IonModal>
    </>
  );
}
