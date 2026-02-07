// src/components/AddOnsModal.tsx
// ✅ STRICT TS
// ✅ NO any
// ✅ THEMED (same as Booking): IonModal className="booking-modal"
// ✅ Uses: .bookadd-card, .form-item, .summary-section, .summary-text
// ✅ NEW: show REMAINING stocks per item (in dropdown + selected list)

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

export default function AddOnsModal({ isOpen, onClose, onSaved, seatGroups }: Props) {
  const [addOns, setAddOns] = useState<AddOn[]>([]);

  const [addOnsFullName, setAddOnsFullName] = useState<string>("");
  const [addOnsSeat, setAddOnsSeat] = useState<string>("");

  // Each block stores chosen category (duplicates allowed)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([""]);
  const [selectedAddOns, setSelectedAddOns] = useState<SelectedAddOn[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchAddOns();

    // Ensure at least 1 block on open
    setSelectedCategories((prev) => (prev.length === 0 ? [""] : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fetchAddOns = async (): Promise<void> => {
    // ✅ Customer: show only in-stock items
    const { data, error } = await supabase
      .from("add_ons")
      .select("*")
      .gt("stocks", 0)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
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

      // compute already chosen excluding this item

      // but we need per-item exclude, not total; simpler:
      const chosenExcludingThis = prev
        .filter((s) => s.id === id)
        .reduce((sum, s) => sum + Math.max(0, Math.floor(toNum(s.quantity))), 0);

      // chosenExcludingThis includes current one too; adjust:
      const currentQty = existing ? Math.max(0, Math.floor(toNum(existing.quantity))) : 0;
      const chosenOtherSameId = chosenExcludingThis - currentQty;

      const maxAllowedForThis = Math.max(0, stocks - chosenOtherSameId);
      const q = Math.min(wanted, maxAllowedForThis);

      if (wanted > maxAllowedForThis) {
        alert(`Only ${maxAllowedForThis} remaining for this item.`);
      }

      if (q > 0) {
        if (existing) return prev.map((s) => (s.id === id ? { ...s, quantity: q } : s));
        if (!addOn) return prev;
        return [...prev, { id, name: addOn.name, category: addOn.category, price: addOn.price, quantity: q }];
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
  };

  // ✅ Removing a block should NOT delete items
  const removeCategoryBlock = (index: number): void => {
    setSelectedCategories((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [""] : next;
    });
  };

  const addAnotherCategory = (): void => {
    setSelectedCategories((prev) => [...prev, ""]);
  };

  const resetAddOnsForm = (): void => {
    setAddOnsFullName("");
    setAddOnsSeat("");
    setSelectedAddOns([]);
    setSelectedCategories([""]);
  };

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
            <IonInput
              value={addOnsFullName}
              placeholder="Enter full name"
              onIonChange={(e) => setAddOnsFullName(e.detail.value ?? "")}
            />
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
            // show only items with remaining > 0 (stocks - selected in cart)
            const categoryItems = addOns
              .filter((a) => a.category === category)
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

                {category ? (
                  <IonItem className="form-item">
                    <IonLabel position="stacked">Select {category} Item</IonLabel>
                    <IonSelect
                      placeholder={categoryItems.length > 0 ? "Choose an item" : "No available items"}
                      disabled={categoryItems.length === 0}
                      onIonChange={(e) => {
                        const selectedId = asString(e.detail.value);
                        if (!selectedId) return;

                        const addOn = addOns.find((a) => a.id === selectedId);
                        if (!addOn) return;

                        // ✅ only add if remaining > 0
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

              {selectedSummaryByCategory.map(({ category, items }) => (
                <React.Fragment key={category}>
                  <IonListHeader>
                    <IonLabel>
                      <strong>{category}</strong>
                    </IonLabel>
                  </IonListHeader>

                  {items.map((selected) => {
                    const stocks = Math.max(0, Math.floor(toNum(stocksById.get(selected.id) ?? 0)));
                    const remainingIfKeepQty = Math.max(0, stocks - selected.quantity);

                    return (
                      <IonItem key={selected.id} className="addon-item">
                        <IonLabel>
                          <div style={{ fontWeight: 700 }}>{selected.name}</div>
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
