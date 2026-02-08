// src/components/AddOnsModal.tsx
// ✅ STRICT TS
// ✅ NO any
// ✅ THEMED (same as Booking): IonModal className="booking-modal"
// ✅ Uses: .bookadd-card, .form-item, .summary-section, .summary-text
// ✅ NEW: show REMAINING stocks per item (in dropdown + selected list)
// ✅ NEW: SIZE FILTER per category (only shows if that category has sizes)
// ✅ Items list depends on selected Category + (optional) Size

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
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

interface AddOn {
  id: string;
  category: string;
  size: string | null; // ✅ NEW (nullable)
  name: string;
  price: number;
  restocked: number;
  sold: number;
  expenses: number;
  stocks: number; // generated / current remaining in DB
  overall_sales: number;
  expected_sales: number;
  image_url: string | null;
}

interface SelectedAddOn {
  id: string;
  name: string;
  category: string;
  size: string | null; // ✅ keep size in chosen items
  price: number;
  quantity: number;
}

type SeatGroup = { title: string; seats: string[] };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void; // parent will show alert + close on OK
  seatGroups: SeatGroup[];
};

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const norm = (s: string): string => s.trim().toLowerCase();
const cleanSize = (s: string | null | undefined): string => (s ?? "").trim();

export default function AddOnsModal({ isOpen, onClose, onSaved, seatGroups }: Props) {
  const [addOns, setAddOns] = useState<AddOn[]>([]);

  const [addOnsFullName, setAddOnsFullName] = useState<string>("");
  const [addOnsSeat, setAddOnsSeat] = useState<string>("");

  // Each block stores chosen category (duplicates allowed)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([""]);
  // ✅ NEW: size per block ("" means no size filter / not selected)
  const [selectedSizes, setSelectedSizes] = useState<string[]>([""]);

  const [selectedAddOns, setSelectedAddOns] = useState<SelectedAddOn[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchAddOns();

    // Ensure at least 1 block on open
    setSelectedCategories((prev) => (prev.length === 0 ? [""] : prev));
    setSelectedSizes((prev) => (prev.length === 0 ? [""] : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fetchAddOns = async (): Promise<void> => {
    // ✅ Customer: show only in-stock items
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
      alert("Error loading add-ons.");
      return;
    }

    setAddOns((data as AddOn[]) || []);
  };

  const categories = useMemo(() => [...new Set(addOns.map((a) => a.category))], [addOns]);

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

  // ✅ NEW: remaining stocks map (from latest loaded addOns)
  const stocksById = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of addOns) m.set(a.id, Math.max(0, Math.floor(toNum(a.stocks))));
    return m;
  }, [addOns]);

  // ✅ NEW: how many already chosen in this modal (reserved in cart)
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

      // chosen excluding this item qty
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
        return [...prev, { id, name: addOn.name, category: addOn.category, size: addOn.size, price: addOn.price, quantity: q }];
      }

      return prev.filter((s) => s.id !== id);
    });
  };

  // ✅ Do NOT delete selected items when switching category
  const handleCategoryChange = (index: number, category: string): void => {
    setSelectedCategories((prev) => {
      const next = [...prev];
      next[index] = category;
      return next;
    });

    // ✅ reset size when category changes (so user re-picks size)
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

  // ✅ Removing a block should NOT delete items
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
  };

  // ✅ helper: get available sizes for a category (based on in-stock addOns)
  const getSizesForCategory = (category: string): string[] => {
    if (!category) return [];
    const sizes = addOns
      .filter((a) => a.category === category)
      .map((a) => cleanSize(a.size))
      .filter((s) => s.length > 0);

    // unique + sort (XS,S,M,L,XL,2XL...) then alpha fallback
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

  // ✅ helper: does this category have sizes at all?
  const categoryHasSizes = (category: string): boolean => getSizesForCategory(category).length > 0;

  const handleSubmitAddOns = async (): Promise<void> => {
    const name = addOnsFullName.trim();
    if (!name) return alert("Full Name is required.");
    if (!addOnsSeat) return alert("Seat Number is required.");
    if (selectedAddOns.length === 0) return alert("Please select at least one add-on.");

    // ✅ Re-check stock before insert (DB truth)
    for (const selected of selectedAddOns) {
      const { data, error } = await supabase.from("add_ons").select("stocks,name").eq("id", selected.id).single();

      if (error) {
        alert(`Stock check error for ${selected.name}: ${error.message}`);
        return;
      }

      const row = data as { stocks: number; name: string };
      const stocksNow = Math.max(0, Math.floor(toNum(row.stocks)));
      const nameNow = row.name ?? selected.name;

      if (stocksNow < selected.quantity) {
        alert(`Insufficient stock for ${nameNow}. Available: ${stocksNow}`);
        return;
      }
    }

    // insert each selected item row
    for (const selected of selectedAddOns) {
      const { error } = await supabase.from("customer_session_add_ons").insert({
        add_on_id: selected.id,
        quantity: selected.quantity,
        price: selected.price,
        full_name: name,
        seat_number: addOnsSeat,
        // optional: if your table has these columns, you can store them too
        // category: selected.category,
        // size: selected.size,
      });

      if (error) {
        alert(`Error adding ${selected.name}: ${error.message}`);
        return;
      }
    }

    void fetchAddOns();

    // parent will show alert then close
    onSaved();

    resetAddOnsForm();
  };

  return (
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
            <IonInput value={addOnsFullName} placeholder="Enter full name" onIonChange={(e) => setAddOnsFullName(e.detail.value ?? "")} />
          </IonItem>

          <IonItem className="form-item">
            <IonLabel position="stacked">Seat Number *</IonLabel>
            <IonSelect value={addOnsSeat} placeholder="Choose seat" onIonChange={(e) => setAddOnsSeat(asString(e.detail.value))}>
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

          {/* CATEGORY BLOCKS */}
          {selectedCategories.map((category, index) => {
            const hasSizes = categoryHasSizes(category);
            const sizeOptions = hasSizes ? getSizesForCategory(category) : [];
            const pickedSize = (selectedSizes[index] ?? "").trim();

            // ✅ rule:
            // - if category has sizes -> show SIZE select
            // - items dropdown only appears after size is selected
            const allowItems = category
              ? hasSizes
                ? pickedSize.length > 0
                : true
              : false;

            // show only items:
            // - in same category
            // - if hasSizes => match picked size
            // - remaining > 0 (stocks - chosen)
            const categoryItems = addOns
              .filter((a) => (category ? a.category === category : false))
              .filter((a) => {
                if (!hasSizes) return true;
                return norm(cleanSize(a.size)) === norm(pickedSize);
              })
              .map((a) => ({ ...a, remaining: getRemainingForId(a.id) }))
              .filter((a) => a.remaining > 0);

            return (
              <div key={`cat-${index}`} className="addon-block">
                <div className="addon-row">
                  <IonItem className="form-item addon-flex">
                    <IonLabel position="stacked">Select Category {index + 1}</IonLabel>
                    <IonSelect value={category} placeholder="Choose a category" onIonChange={(e) => handleCategoryChange(index, asString(e.detail.value))}>
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

                {/* ✅ SIZE appears under category if category has sizes */}
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

                {/* ✅ ITEM only shows after category AND (if needed) size is selected */}
                {allowItems ? (
                  <IonItem className="form-item">
                    <IonLabel position="stacked">
                      Select {category} Item{hasSizes ? ` (${pickedSize})` : ""}
                    </IonLabel>
                    <IonSelect
                      placeholder={categoryItems.length > 0 ? "Choose an item" : "No available items"}
                      disabled={categoryItems.length === 0}
                      onIonChange={(e) => {
                        const selectedId = asString(e.detail.value);
                        if (!selectedId) return;

                        const addOn = addOns.find((a) => a.id === selectedId);
                        if (!addOn) return;

                        const remaining = getRemainingForId(selectedId);
                        if (remaining <= 0) {
                          alert("No remaining stock for this item.");
                          return;
                        }

                        setSelectedAddOns((prev) => {
                          const existing = prev.find((s) => s.id === selectedId);
                          if (existing) return prev; // already added (qty editable below)
                          return [
                            ...prev,
                            {
                              id: selectedId,
                              name: addOn.name,
                              category: addOn.category,
                              size: addOn.size,
                              price: addOn.price,
                              quantity: 1,
                            },
                          ];
                        });
                      }}
                    >
                      {categoryItems.map((a) => (
                        <IonSelectOption key={a.id} value={a.id}>
                          {a.name} - ₱{a.price} (Remaining: {a.remaining})
                        </IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>
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
                        <IonLabel>
                          <div style={{ fontWeight: 700 }}>
                            {selected.name}{" "}
                            {cleanSize(selected.size) ? <span style={{ opacity: 0.85 }}>({cleanSize(selected.size)})</span> : null}
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

          <IonButton expand="block" onClick={() => void handleSubmitAddOns()}>
            Submit Order
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
}
