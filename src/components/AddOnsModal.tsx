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
  IonSegment,
  IonSegmentButton,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

/* =========================
   TYPES
========================= */

type Mode = "add_ons" | "consignment";

type SeatGroup = { title: string; seats: string[] };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  seatGroups: SeatGroup[];
};

// RPC payloads
type RpcAddOnItem = { add_on_id: string; quantity: number };
type RpcConsignItem = { consignment_id: string; quantity: number };

/* =========================
   DB ROW TYPES
========================= */

type AddOnRow = {
  id: string;
  category: string;
  size: string | null;
  name: string;
  price: number | string;
  restocked: number | string | null;
  sold: number | string | null;
  expenses: number | string | null;
  stocks: number | string | null;
  overall_sales: number | string | null;
  expected_sales: number | string | null;
  image_url: string | null;
};

type ConsignmentRow = {
  id: string;
  full_name: string; // owner name (old)
  category?: string | null; // ✅ if you already have consignment.category, use it
  item_name: string;
  size: string | null;
  image_url: string | null;
  price: number | string;
  restocked: number | string | null;
  sold: number | string | null;
  expected_sales: number | string | null;
  overall_sales: number | string | null;
  stocks: number | string | null;
};

/* =========================
   APP ITEM TYPES (discriminator)
========================= */

interface AddOn {
  kind: "add_ons";
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

interface ConsignmentItem {
  kind: "consignment";
  id: string;
  category: string; // ✅ show as CATEGORY in UI
  size: string | null;
  name: string; // item_name
  price: number;
  restocked: number;
  sold: number;
  stocks: number;
  overall_sales: number;
  expected_sales: number;
  image_url: string | null;
}

type Item = AddOn | ConsignmentItem;

interface SelectedItem {
  id: string;
  kind: Item["kind"];
  name: string;
  category: string;
  size: string | null;
  price: number;
  quantity: number;
  image_url: string | null;
}

/* =========================
   HELPERS
========================= */

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const toNum = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const toInt = (v: unknown): number => Math.max(0, Math.floor(toNum(v)));

const norm = (s: string): string => s.trim().toLowerCase();
const cleanSize = (s: string | null | undefined): string => (s ?? "").trim();

const isConsignmentItem = (x: Item): x is ConsignmentItem => x.kind === "consignment";

// ✅ IMPORTANT: hide this category name in add_ons mode
const isConsignmentCategory = (cat: string): boolean => norm(cat) === "consignment";

/* =========================
   COMPONENT
========================= */

export default function AddOnsModal({ isOpen, onClose, onSaved, seatGroups }: Props) {
  const [mode, setMode] = useState<Mode>("add_ons");

  const [items, setItems] = useState<Item[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const [fullName, setFullName] = useState<string>("");
  const [seat, setSeat] = useState<string>("");

  const [selectedCategories, setSelectedCategories] = useState<string[]>([""]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([""]);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  // picker modal
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [pickerCategory, setPickerCategory] = useState<string>("");
  const [pickerSize, setPickerSize] = useState<string>("");
  const [pickerSearch, setPickerSearch] = useState<string>("");

  useEffect(() => {
    if (!isOpen) return;

    // reset picker when switching mode/opening
    setPickerCategory("");
    setPickerSize("");
    setPickerSearch("");
    setIsPickerOpen(false);

    setSelectedCategories((prev) => (prev.length === 0 ? [""] : prev));
    setSelectedSizes((prev) => (prev.length === 0 ? [""] : prev));

    void fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode]);

  const fetchItems = async (): Promise<void> => {
    if (mode === "add_ons") {
      const { data, error } = await supabase
        .from("add_ons")
        .select("id, category, size, name, price, restocked, sold, expenses, stocks, overall_sales, expected_sales, image_url")
        .gt("stocks", 0)
        .order("category", { ascending: true })
        .order("size", { ascending: true })
        .order("name", { ascending: true })
        .returns<AddOnRow[]>();

      if (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        alert(`Error loading add-ons: ${error.message}`);
        setItems([]);
        return;
      }

      const mappedAll: AddOn[] = (data ?? []).map((r) => ({
        kind: "add_ons",
        id: r.id,
        category: String(r.category ?? "").trim(),
        size: r.size ?? null,
        name: String(r.name ?? "").trim(),
        price: toNum(r.price),
        restocked: toInt(r.restocked),
        sold: toInt(r.sold),
        expenses: toNum(r.expenses),
        stocks: toInt(r.stocks),
        overall_sales: toNum(r.overall_sales),
        expected_sales: toNum(r.expected_sales),
        image_url: r.image_url ?? null,
      }));

      // ✅ Remove "Consignment" category rows from Add-Ons list
      const mapped = mappedAll.filter((a) => !isConsignmentCategory(a.category));
      setItems(mapped);
      return;
    }

    // consignment
    const { data, error } = await supabase
      .from("consignment")
      .select("id, full_name, category, item_name, size, image_url, price, restocked, sold, expected_sales, overall_sales, stocks")
      .gt("stocks", 0)
      .order("category", { ascending: true })
      .order("full_name", { ascending: true })
      .order("size", { ascending: true })
      .order("item_name", { ascending: true })
      .returns<ConsignmentRow[]>();

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert(`Error loading consignment: ${error.message}`);
      setItems([]);
      return;
    }

    const mapped: ConsignmentItem[] = (data ?? []).map((r) => {
      // ✅ CATEGORY VALUE:
      // priority: consignment.category (if you already have it)
      // fallback: full_name (old owner)
      const categoryLabel = String((r.category ?? r.full_name) ?? "").trim() || "Consignment";

      return {
        kind: "consignment",
        id: r.id,
        category: categoryLabel,
        name: String(r.item_name ?? "").trim() || "-",
        size: r.size ?? null,
        image_url: r.image_url ?? null,
        price: toNum(r.price),
        restocked: toInt(r.restocked),
        sold: toInt(r.sold),
        stocks: toInt(r.stocks),
        overall_sales: toNum(r.overall_sales),
        expected_sales: toNum(r.expected_sales),
      };
    });

    setItems(mapped);
  };

  // ✅ categories list (also hide "consignment" when mode is add_ons)
  const categories = useMemo(() => {
    const base = items.map((a) => a.category).filter((c) => c.trim().length > 0);
    const filtered = mode === "add_ons" ? base.filter((c) => !isConsignmentCategory(c)) : base;

    const uniq = Array.from(new Set(filtered));
    uniq.sort((a, b) => a.localeCompare(b));
    return uniq;
  }, [items, mode]);

  const totalAmount = useMemo<number>(() => selectedItems.reduce((sum, s) => sum + s.quantity * s.price, 0), [selectedItems]);

  const selectedSummaryByCategory = useMemo(() => {
    const map = new Map<string, SelectedItem[]>();
    for (const it of selectedItems) {
      const cat = it.category || "Uncategorized";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(it);
    }
    return Array.from(map.entries()).map(([category, block]) => ({
      category,
      items: block.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [selectedItems]);

  const stocksById = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of items) m.set(a.id, toInt(a.stocks));
    return m;
  }, [items]);

  const selectedQtyById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of selectedItems) m.set(s.id, (m.get(s.id) ?? 0) + Math.max(0, Math.floor(toNum(s.quantity))));
    return m;
  }, [selectedItems]);

  const getRemainingForId = (id: string): number => {
    const stocks = stocksById.get(id) ?? 0;
    const chosen = selectedQtyById.get(id) ?? 0;
    return Math.max(0, stocks - chosen);
  };

  const handleQuantityChange = (id: string, quantity: number): void => {
    const wanted = Math.max(0, Math.floor(quantity));

    setSelectedItems((prev) => {
      const existing = prev.find((s) => s.id === id);
      const item = items.find((a) => a.id === id);
      if (!item) return prev;

      const stocks = Math.max(0, Math.floor(toNum(stocksById.get(id) ?? item.stocks)));
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

        return [
          ...prev,
          {
            id: item.id,
            kind: item.kind,
            name: item.name,
            category: item.category,
            size: item.size ?? null,
            price: toNum(item.price),
            quantity: q,
            image_url: item.image_url ?? null,
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

  const resetForm = (): void => {
    setFullName("");
    setSeat("");
    setSelectedItems([]);
    setSelectedCategories([""]);
    setSelectedSizes([""]);
    setPickerSearch("");
    setPickerCategory("");
    setPickerSize("");
    setIsPickerOpen(false);
  };

  const getSizesForCategory = (category: string): string[] => {
    if (!category) return [];
    const sizes = items
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

  const pickerItems = useMemo<Item[]>(() => {
    const cat = pickerCategory;
    const hasSizes = categoryHasSizes(cat);
    const size = pickerSize.trim();
    const q = pickerSearch.trim().toLowerCase();

    return items
      .filter((a) => (cat ? a.category === cat : false))
      .filter((a) => {
        if (!hasSizes) return true;
        return norm(cleanSize(a.size)) === norm(size);
      })
      .filter((a) => getRemainingForId(a.id) > 0)
      .filter((a) => {
        if (!q) return true;
        return a.name.toLowerCase().includes(q);
      });
  }, [items, pickerCategory, pickerSize, pickerSearch, selectedItems]);

  const openPicker = (category: string, size: string): void => {
    setPickerCategory(category);
    setPickerSize(size);
    setPickerSearch("");
    setIsPickerOpen(true);
  };

  const addFromPicker = (item: Item): void => {
    const remaining = getRemainingForId(item.id);
    if (remaining <= 0) {
      alert("No remaining stock for this item.");
      return;
    }

    setSelectedItems((prev) => {
      const existing = prev.find((s) => s.id === item.id);
      if (existing) return prev;

      return [
        ...prev,
        {
          id: item.id,
          kind: item.kind,
          name: item.name,
          category: item.category,
          size: item.size ?? null,
          price: toNum(item.price),
          quantity: 1,
          image_url: item.image_url ?? null,
        },
      ];
    });

    setIsPickerOpen(false);
  };

  const handleSubmit = async (): Promise<void> => {
    const buyerName = fullName.trim();
    if (!buyerName) return alert("Full Name is required.");
    if (!seat) return alert("Seat Number is required.");
    if (selectedItems.length === 0) return alert("Please select at least one item.");

    // prevent mixing
    const kindMismatch = selectedItems.some((s) => (mode === "add_ons" ? s.kind !== "add_ons" : s.kind !== "consignment"));
    if (kindMismatch) {
      alert("Selected items do not match the chosen Type. Please Reset and try again.");
      return;
    }

    setIsSaving(true);
    try {
      if (mode === "add_ons") {
        const payload: RpcAddOnItem[] = selectedItems.map((s) => ({
          add_on_id: s.id,
          quantity: Math.max(1, Math.floor(toNum(s.quantity))),
        }));

        const { error } = await supabase.rpc("place_addon_order", {
          p_full_name: buyerName,
          p_seat_number: seat,
          p_items: payload,
        });

        if (error) {
          // eslint-disable-next-line no-console
          console.error(error);
          alert(`Order failed: ${error.message}`);
          return;
        }
      } else {
        const payload: RpcConsignItem[] = selectedItems.map((s) => ({
          consignment_id: s.id,
          quantity: Math.max(1, Math.floor(toNum(s.quantity))),
        }));

        const { error } = await supabase.rpc("place_consignment_order", {
          p_full_name: buyerName,
          p_seat_number: seat,
          p_items: payload,
        });

        if (error) {
          // eslint-disable-next-line no-console
          console.error(error);
          alert(`Consignment order failed: ${error.message}`);
          return;
        }
      }

      await fetchItems();
      onSaved();
      resetForm();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const blockLabel = mode === "add_ons" ? "Category" : "Category";
  const blockPlaceholder = mode === "add_ons" ? "Choose a category" : "Choose a category";

  return (
    <>
      <IonModal isOpen={isOpen} onDidDismiss={onClose} className="booking-modal">
        <IonHeader>
          <IonToolbar>
            <IonTitle>{mode === "add_ons" ? "Add-Ons" : "Consignment"}</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={onClose}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>

        <IonContent className="ion-padding">
          <div className="bookadd-card">
            {/* MODE SWITCH */}
            <div style={{ marginBottom: 10 }}>
              <IonLabel style={{ fontWeight: 800, display: "block", marginBottom: 6 }}>Type</IonLabel>
              <IonSegment
                value={mode}
                onIonChange={(e) => {
                  const v = asString(e.detail.value) as Mode;
                  setMode(v);
                  // prevent mixing when switching
                  setSelectedItems([]);
                  setSelectedCategories([""]);
                  setSelectedSizes([""]);
                }}
              >
                <IonSegmentButton value="add_ons">
                  <IonLabel>Add-Ons</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="consignment">
                  <IonLabel>Consignment</IonLabel>
                </IonSegmentButton>
              </IonSegment>
            </div>

            <IonItem className="form-item">
              <IonLabel position="stacked">Full Name *</IonLabel>
              <IonInput value={fullName} placeholder="Enter full name" onIonChange={(e) => setFullName(e.detail.value ?? "")} />
            </IonItem>

            <IonItem className="form-item">
              <IonLabel position="stacked">Seat Number *</IonLabel>
              <IonSelect value={seat} placeholder="Choose seat" onIonChange={(e) => setSeat(asString(e.detail.value))}>
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
              Add More {mode === "add_ons" ? "Add-Ons" : "Consignment"}
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
                      <IonLabel position="stacked">{`Select ${blockLabel} ${index + 1}`}</IonLabel>
                      <IonSelect
                        value={category}
                        placeholder={blockPlaceholder}
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
                      <IonSelect value={pickedSize} placeholder="Choose size" onIonChange={(e) => handleSizeChange(index, asString(e.detail.value))}>
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
                      Choose Item{hasSizes ? ` (${pickedSize})` : ""}
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
            {selectedItems.length > 0 ? (
              <IonList style={{ marginTop: 12 }}>
                <IonListHeader>
                  <IonLabel>Selected Items</IonLabel>
                </IonListHeader>

                {selectedSummaryByCategory.map(({ category: catTitle, items: blockItems }) => (
                  <React.Fragment key={catTitle}>
                    <IonListHeader>
                      <IonLabel>
                        <strong>{catTitle}</strong>
                      </IonLabel>
                    </IonListHeader>

                    {blockItems.map((selected) => {
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
                              {selected.name} {cleanSize(selected.size) ? <span style={{ opacity: 0.85 }}>({cleanSize(selected.size)})</span> : null}
                            </div>
                            <div style={{ opacity: 0.85 }}>₱{selected.price}</div>
                            <div style={{ marginTop: 4, fontWeight: 700 }}>Subtotal: ₱{(selected.price * selected.quantity).toFixed(2)}</div>
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
                                handleQuantityChange(selected.id, Number.isNaN(v) ? 0 : v);
                              }}
                            />

                            <IonButton color="danger" onClick={() => setSelectedItems((prev) => prev.filter((s) => s.id !== selected.id))}>
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
                <strong>Total: ₱{totalAmount.toFixed(2)}</strong>
              </p>
            </div>

            <IonButton expand="block" disabled={isSaving} onClick={() => void handleSubmit()}>
              {isSaving ? "Saving..." : "Submit Order"}
            </IonButton>

            <IonButton
              expand="block"
              fill="clear"
              onClick={() => {
                resetForm();
                onClose();
              }}
              style={{ marginTop: 6 }}
            >
              Reset
            </IonButton>
          </div>
        </IonContent>
      </IonModal>

      {/* ITEM PICKER MODAL */}
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
                      <div style={{ fontWeight: 800 }}>
                        {a.name}
                        {isConsignmentItem(a) ? <span style={{ marginLeft: 8, opacity: 0.7, fontWeight: 700 }}>• Category</span> : null}
                      </div>
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
