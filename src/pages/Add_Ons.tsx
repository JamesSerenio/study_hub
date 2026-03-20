// src/pages/Add_Ons.tsx
// ✅ Fixed iOS dark rendering issue
// ✅ Safer page-level CSS vars for Ionic
// ✅ White cards / list / inputs / searchbar on iPhone
// ✅ Approved consignment items only
// ✅ Pending / Rejected consignment items will NOT show
// ✅ Removed extra "Choose Food Item" button
// ✅ Picker auto-opens below after category/size selection
// ✅ Add More button moved above Submit Order
// ✅ Same logic and functions retained
// ✅ STRICT TS, NO any
// ✅ NEW: Booking code input required
// ✅ NEW: Validates booking code from customer_sessions
// ✅ NEW: Shows "This code expired." if booking time already ended
// ✅ NEW: Only valid active code can order add-ons / other items

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
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
  IonToast,
  IonSpinner,
  IonModal,
  IonSegment,
  IonSegmentButton,
} from "@ionic/react";
import { closeOutline, checkmarkCircleOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";
import leaves from "../assets/leave.png";

/* =========================
   TYPES
========================= */

type Mode = "add_ons" | "consignment";

interface AddOnRow {
  id: string;
  category: string;
  size: string | null;
  name: string;
  price: number | string;
  restocked: number | string | null;
  sold: number | string | null;
  expenses_cost: number | string | null;
  expenses: number | string | null;
  stocks: number | string | null;
  overall_sales: number | string | null;
  expected_sales: number | string | null;
  image_url: string | null;
}

interface ConsignmentRow {
  id: string;
  full_name: string;
  category?: string | null;
  item_name: string;
  size: string | null;
  image_url: string | null;
  price: number | string;
  restocked: number | string | null;
  sold: number | string | null;
  expected_sales: number | string | null;
  overall_sales: number | string | null;
  stocks: number | string | null;
  approval_status?: string | null;
}

interface ItemBase {
  id: string;
  category: string;
  size: string | null;
  name: string;
  price: number;
  restocked: number;
  sold: number;
  stocks: number;
  overall_sales: number;
  expected_sales: number;
  image_url: string | null;
}

interface AddOnItem extends ItemBase {
  kind: "add_ons";
  expenses_cost: number;
  expenses: number;
}

interface ConsignmentItem extends ItemBase {
  kind: "consignment";
}

type Item = AddOnItem | ConsignmentItem;

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

type SeatGroup = { title: string; seats: string[] };

type CustomerSessionCodeRow = {
  id: string;
  booking_code: string | null;
  full_name: string;
  seat_number: string;
  time_started: string;
  time_ended: string | null;
};

const DEFAULT_SEAT_GROUPS: SeatGroup[] = [
  {
    title: "1stF",
    seats: ["1", "2", "3", "4", "5", "6", "7a", "7b", "8a", "8b", "9", "10", "11"],
  },
  {
    title: "TATAMI AREA",
    seats: ["12a", "12b", "12c"],
  },
  {
    title: "2ndF",
    seats: ["13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"],
  },
];

const SUCCESS_MESSAGE =
  "Thank you! Kindly proceed to the counter for pickup and payment.";

/* =========================
   HELPERS
========================= */

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toInt = (v: unknown): number => Math.max(0, Math.floor(toNum(v)));

const norm = (s: string): string => s.trim().toLowerCase();
const cleanSize = (s: string | null | undefined): string => (s ?? "").trim();

const isConsignmentCategory = (cat: string): boolean =>
  norm(cat) === "consignment";

const normalizeBookingCode = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

type RpcAddOnItem = { add_on_id: string; quantity: number };
type RpcConsignItem = { consignment_id: string; quantity: number };

/* =========================
   PAGE
========================= */

const Add_Ons: React.FC = () => {
  const [mode, setMode] = useState<Mode>("add_ons");
  const seatGroups = DEFAULT_SEAT_GROUPS;

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [toastMsg, setToastMsg] = useState<string>("");
  const [showToast, setShowToast] = useState<boolean>(false);
  const toastColor = useMemo<"success" | "danger">(
    () =>
      toastMsg.toLowerCase().includes("success") ? "success" : "danger",
    [toastMsg]
  );

  const [successOpen, setSuccessOpen] = useState<boolean>(false);

  const [items, setItems] = useState<Item[]>([]);
  const [fullName, setFullName] = useState<string>("");
  const [seat, setSeat] = useState<string>("");
  const [bookingCode, setBookingCode] = useState<string>("");

  const [selectedCategories, setSelectedCategories] = useState<string[]>([""]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([""]);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [pickerCategory, setPickerCategory] = useState<string>("");
  const [pickerSize, setPickerSize] = useState<string>("");
  const [pickerSearch, setPickerSearch] = useState<string>("");

  const showError = (msg: string): void => {
    setToastMsg(msg);
    setShowToast(true);
  };

  const showSuccessToast = (msg: string): void => {
    setToastMsg(msg);
    setShowToast(true);
  };

  const resetForm = (): void => {
    setFullName("");
    setSeat("");
    setBookingCode("");
    setSelectedItems([]);
    setSelectedCategories([""]);
    setSelectedSizes([""]);
    setPickerSearch("");
    setPickerCategory("");
    setPickerSize("");
    setIsPickerOpen(false);
  };

  const closeSuccess = (): void => setSuccessOpen(false);

  useEffect(() => {
    void fetchItems();
    setSelectedCategories((prev) => (prev.length === 0 ? [""] : prev));
    setSelectedSizes((prev) => (prev.length === 0 ? [""] : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const fetchItems = async (): Promise<void> => {
    setIsLoading(true);
    try {
      if (mode === "add_ons") {
        const { data, error } = await supabase
          .from("add_ons")
          .select("*")
          .gt("stocks", 0)
          .order("category", { ascending: true })
          .order("size", { ascending: true })
          .order("name", { ascending: true })
          .returns<AddOnRow[]>();

        if (error) {
          console.error(error);
          showError(`Error loading add-ons: ${error.message}`);
          setItems([]);
          return;
        }

        const mappedAll: AddOnItem[] = (data ?? []).map((r) => ({
          kind: "add_ons",
          id: r.id,
          category: String(r.category ?? "").trim(),
          size: r.size ?? null,
          name: String(r.name ?? "").trim(),
          price: toNum(r.price),
          restocked: toInt(r.restocked),
          sold: toInt(r.sold),
          expenses_cost: toNum(r.expenses_cost),
          expenses: toNum(r.expenses),
          stocks: toInt(r.stocks),
          overall_sales: toNum(r.overall_sales),
          expected_sales: toNum(r.expected_sales),
          image_url: r.image_url ?? null,
        }));

        const filtered = mappedAll.filter(
          (a) => !isConsignmentCategory(a.category)
        );

        setItems(filtered);
        return;
      }

      const { data, error } = await supabase
        .from("consignment")
        .select(
          "id, full_name, category, item_name, size, image_url, price, restocked, sold, expected_sales, overall_sales, stocks, approval_status"
        )
        .eq("approval_status", "approved")
        .gt("stocks", 0)
        .order("category", { ascending: true })
        .order("full_name", { ascending: true })
        .order("size", { ascending: true })
        .order("item_name", { ascending: true })
        .returns<ConsignmentRow[]>();

      if (error) {
        console.error(error);
        showError(`Error loading consignment: ${error.message}`);
        setItems([]);
        return;
      }

      const mapped: ConsignmentItem[] = (data ?? []).map((r) => {
        const categoryLabel =
          String((r.category ?? r.full_name) ?? "").trim() || "Consignment";

        return {
          kind: "consignment",
          id: r.id,
          category: categoryLabel,
          size: r.size ?? null,
          name: String(r.item_name ?? "").trim() || "-",
          price: toNum(r.price),
          restocked: toInt(r.restocked),
          sold: toInt(r.sold),
          stocks: toInt(r.stocks),
          overall_sales: toNum(r.overall_sales),
          expected_sales: toNum(r.expected_sales),
          image_url: r.image_url ?? null,
        };
      });

      setItems(mapped);
    } finally {
      setIsLoading(false);
    }
  };

  const categories = useMemo(() => {
    const base = items.map((a) => a.category).filter((c) => c.trim().length > 0);
    const uniq = Array.from(new Set(base));
    uniq.sort((a, b) => a.localeCompare(b));
    return uniq;
  }, [items]);

  const totalAmount = useMemo<number>(
    () => selectedItems.reduce((sum, s) => sum + s.quantity * s.price, 0),
    [selectedItems]
  );

  const selectedSummaryByCategory = useMemo(() => {
    const map = new Map<string, SelectedItem[]>();
    for (const item of selectedItems) {
      const cat = item.category || "Uncategorized";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return Array.from(map.entries()).map(([category, list]) => ({
      category,
      items: list.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [selectedItems]);

  const stocksById = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of items) m.set(a.id, Math.max(0, Math.floor(toNum(a.stocks))));
    return m;
  }, [items]);

  const selectedQtyById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of selectedItems) {
      m.set(s.id, (m.get(s.id) ?? 0) + Math.max(0, Math.floor(toNum(s.quantity))));
    }
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

      const stocks = Math.max(
        0,
        Math.floor(toNum(stocksById.get(id) ?? item.stocks))
      );

      const currentQty = existing
        ? Math.max(0, Math.floor(toNum(existing.quantity)))
        : 0;

      const chosenTotalSameId = prev
        .filter((s) => s.id === id)
        .reduce(
          (sum, s) => sum + Math.max(0, Math.floor(toNum(s.quantity))),
          0
        );

      const chosenOtherSameId = Math.max(0, chosenTotalSameId - currentQty);
      const maxAllowedForThis = Math.max(0, stocks - chosenOtherSameId);
      const q = Math.min(wanted, maxAllowedForThis);

      if (wanted > maxAllowedForThis) {
        showError(`Only ${maxAllowedForThis} remaining for this item.`);
      }

      if (q > 0) {
        if (existing) {
          return prev.map((s) => (s.id === id ? { ...s, quantity: q } : s));
        }

        return [
          ...prev,
          {
            id: item.id,
            kind: item.kind,
            name: item.name,
            category: item.category,
            size: item.size,
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

    const hasSizes = getSizesForCategory(category).length > 0;

    setSelectedSizes((prev) => {
      const next = [...prev];
      next[index] = "";
      return next;
    });

    setPickerSearch("");

    if (!category) {
      setIsPickerOpen(false);
      setPickerCategory("");
      setPickerSize("");
      return;
    }

    if (!hasSizes) {
      setPickerCategory(category);
      setPickerSize("");
      setIsPickerOpen(true);
    } else {
      setIsPickerOpen(false);
      setPickerCategory("");
      setPickerSize("");
    }
  };

  const handleSizeChange = (index: number, size: string): void => {
    setSelectedSizes((prev) => {
      const next = [...prev];
      next[index] = size;
      return next;
    });

    const category = selectedCategories[index] ?? "";
    setPickerSearch("");

    if (category && size.trim()) {
      setPickerCategory(category);
      setPickerSize(size);
      setIsPickerOpen(true);
    } else {
      setIsPickerOpen(false);
      setPickerCategory("");
      setPickerSize("");
    }
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

    setIsPickerOpen(false);
    setPickerCategory("");
    setPickerSize("");
    setPickerSearch("");
  };

  const addAnotherCategory = (): void => {
    setSelectedCategories((prev) => [...prev, ""]);
    setSelectedSizes((prev) => [...prev, ""]);
    setIsPickerOpen(false);
    setPickerCategory("");
    setPickerSize("");
    setPickerSearch("");
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

  const categoryHasSizes = (category: string): boolean =>
    getSizesForCategory(category).length > 0;

  const pickerItems = useMemo(() => {
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
      .map((a) => ({ ...a, remaining: getRemainingForId(a.id) }))
      .filter((a) => a.remaining > 0)
      .filter((a) => {
        if (!q) return true;
        return a.name.toLowerCase().includes(q);
      });
  }, [items, pickerCategory, pickerSize, pickerSearch, selectedItems]);

  const addFromPicker = (item: Item): void => {
    const remaining = getRemainingForId(item.id);
    if (remaining <= 0) {
      showError("No remaining stock for this item.");
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
          size: item.size,
          price: toNum(item.price),
          quantity: 1,
          image_url: item.image_url ?? null,
        },
      ];
    });

    setIsPickerOpen(false);
  };

  const validateBookingCode = async (): Promise<{
    ok: true;
    session: CustomerSessionCodeRow;
  } | {
    ok: false;
    message: string;
  }> => {
    const code = normalizeBookingCode(bookingCode);

    if (!code || code.length !== 4) {
      return { ok: false, message: "Booking Code is required. Enter the 4-character code." };
    }

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("id, booking_code, full_name, seat_number, time_started, time_ended")
      .eq("booking_code", code)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<CustomerSessionCodeRow>();

    if (error) {
      return { ok: false, message: `Code check failed: ${error.message}` };
    }

    if (!data) {
      return { ok: false, message: "Invalid booking code." };
    }

    const nowMs = Date.now();
    const endMs = data.time_ended ? new Date(data.time_ended).getTime() : Number.NaN;

    if (Number.isFinite(endMs) && nowMs > endMs) {
      return { ok: false, message: "This code expired." };
    }

    return { ok: true, session: data };
  };

  const handleSubmit = async (): Promise<void> => {
    const name = fullName.trim();
    if (!name) return showError("Full Name is required.");
    if (!seat) return showError("Seat Number is required.");
    if (selectedItems.length === 0) {
      return showError("Please select at least one item.");
    }

    const codeCheck = await validateBookingCode();
    if (!codeCheck.ok) {
      showError(codeCheck.message);
      return;
    }

    const mismatch = selectedItems.some((s) =>
      mode === "add_ons" ? s.kind !== "add_ons" : s.kind !== "consignment"
    );

    if (mismatch) {
      showError("Selected items do not match the chosen Type. Please Reset and try again.");
      return;
    }

    setIsLoading(true);

    try {
      if (mode === "add_ons") {
        const payload: RpcAddOnItem[] = selectedItems.map((s) => ({
          add_on_id: s.id,
          quantity: Math.max(1, Math.floor(toNum(s.quantity))),
        }));

        const { error } = await supabase.rpc("place_addon_order", {
          p_full_name: name,
          p_seat_number: seat,
          p_items: payload,
        });

        if (error) {
          console.error(error);
          showError(`Order failed: ${error.message}`);
          return;
        }
      } else {
        const payload: RpcConsignItem[] = selectedItems.map((s) => ({
          consignment_id: s.id,
          quantity: Math.max(1, Math.floor(toNum(s.quantity))),
        }));

        const { error } = await supabase.rpc("place_consignment_order", {
          p_full_name: name,
          p_seat_number: seat,
          p_items: payload,
        });

        if (error) {
          console.error(error);
          showError(`Consignment order failed: ${error.message}`);
          return;
        }
      }

      await fetchItems();

      setSuccessOpen(true);
      showSuccessToast(
        `${mode === "add_ons" ? "Add-ons" : "Consignment"} saved successfully!`
      );

      resetForm();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <IonPage>
      <style>
        {`
          :root {
            color-scheme: light;
          }

          ion-content.ao-page-scroll {
            --background: #f8f6ef !important;
            --color: #111111 !important;
            --ion-background-color: #f8f6ef !important;
            --ion-text-color: #111111 !important;
            background: #f8f6ef !important;
          }

          ion-content.ao-page-scroll::part(background) {
            background: #f8f6ef !important;
          }

          .ao-page-scroll,
          .ao-page-scroll ion-label,
          .ao-page-scroll ion-text,
          .ao-page-scroll p,
          .ao-page-scroll h1,
          .ao-page-scroll h2,
          .ao-page-scroll h3,
          .ao-page-scroll h4,
          .ao-page-scroll h5,
          .ao-page-scroll h6,
          .ao-page-scroll span,
          .ao-page-scroll div,
          .ao-page-scroll strong,
          .ao-page-scroll small {
            color: #111111 !important;
          }

          .ao-wrapper {
            padding: 18px 14px 28px;
          }

          .ao-card {
            background: #f7f4ed !important;
            border-radius: 24px;
            padding: 18px 14px 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.08);
            border: 1px solid rgba(0,0,0,0.05);
          }

          .ao-topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 10px;
          }

          .ao-title {
            font-size: 20px;
            font-weight: 900;
            color: #111111 !important;
          }

          .ao-close {
            --color: #111111 !important;
          }

          .ao-page-scroll .ao-form-item,
          .ao-page-scroll .addon-item,
          .ao-page-scroll .ao-picker ion-item {
            --background: #ffffff !important;
            --color: #111111 !important;
            --border-color: rgba(0,0,0,0.08) !important;
            --inner-border-width: 0 0 1px 0 !important;
            --padding-start: 12px;
            --inner-padding-end: 12px;
            margin-bottom: 10px;
            border-radius: 14px;
            overflow: hidden;
            box-shadow: 0 1px 0 rgba(0,0,0,0.04);
          }

          .ao-form-item-compact {
            margin-bottom: 0;
          }

          .ao-page-scroll ion-list,
          .ao-page-scroll .ao-picker,
          .ao-page-scroll .summary-section,
          .ao-page-scroll .addon-block {
            background: transparent !important;
          }

          .ao-picker {
            background: #f7f4ed !important;
            border-radius: 18px;
            padding: 10px;
            border: 1px solid rgba(0,0,0,0.06);
          }

          .ao-picker-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
          }

          .ao-page-scroll ion-searchbar {
            --background: #ffffff !important;
            --color: #111111 !important;
            --placeholder-color: rgba(0,0,0,0.55) !important;
            --icon-color: #111111 !important;
            --clear-button-color: #111111 !important;
            --cancel-button-color: #111111 !important;
            --box-shadow: none !important;
            padding: 0 !important;
            margin-bottom: 10px;
          }

          .ao-page-scroll ion-searchbar .searchbar-input-container,
          .ao-page-scroll ion-searchbar input,
          .ao-page-scroll ion-searchbar textarea {
            color: #111111 !important;
            background: #ffffff !important;
          }

          .ao-page-scroll ion-input,
          .ao-page-scroll ion-select {
            --color: #111111 !important;
            color: #111111 !important;
          }

          .ao-page-scroll input,
          .ao-page-scroll textarea {
            color: #111111 !important;
            -webkit-text-fill-color: #111111 !important;
          }

          .ao-page-scroll input::placeholder,
          .ao-page-scroll textarea::placeholder {
            color: rgba(0,0,0,0.55) !important;
            opacity: 1 !important;
          }

          .ao-page-scroll ion-segment {
            background: #ffffff !important;
            border-radius: 14px;
            padding: 4px;
          }

          .ao-page-scroll ion-segment-button {
            --color: #222222 !important;
            --color-checked: #ffffff !important;
            --background-checked: #6a8f4e !important;
            min-height: 42px;
            font-weight: 700;
          }

          .ao-page-scroll ion-thumbnail {
            --border-radius: 12px;
            border-radius: 12px;
            overflow: hidden;
            background: #f0f0f0;
            flex-shrink: 0;
          }

          .ao-page-scroll ion-thumbnail img,
          .ao-page-scroll ion-img::part(image) {
            object-fit: cover;
          }

          .addon-row {
            display: flex;
            gap: 10px;
            align-items: flex-end;
          }

          .addon-flex {
            flex: 1;
          }

          .addon-actions {
            display: flex;
            flex-direction: column;
            gap: 6px;
            align-items: flex-end;
            min-width: 96px;
          }

          .qty-label {
            font-size: 12px;
            font-weight: 700;
          }

          .qty-input {
            width: 82px;
            --background: #ffffff !important;
            --color: #111111 !important;
            border: 1px solid rgba(0,0,0,0.12);
            border-radius: 10px;
            text-align: center;
            padding-inline: 8px;
          }

          .summary-section {
            background: #ffffff !important;
            border-radius: 14px;
            padding: 12px 14px;
            border: 1px solid rgba(0,0,0,0.06);
          }

          .summary-text {
            margin: 0;
            font-size: 16px;
          }

          .ao-primary {
            --background: #6a8f4e;
            --background-hover: #5f8247;
            --background-activated: #5f8247;
            --color: #ffffff;
            --border-radius: 14px;
            height: 48px;
            font-weight: 800;
            text-transform: none;
            margin-top: 10px;
          }

          .btn-green {
            text-transform: uppercase;
          }

          .ao-success-modal {
            --width: 320px;
            --height: auto;
            --border-radius: 22px;
            --background: transparent;
            --box-shadow: none;
          }

          .ao-success-modal::part(content) {
            border-radius: 22px;
            overflow: hidden;
            background: transparent;
            box-shadow: none;
          }

          .ao-success-box {
            background: #ffffff;
            border-radius: 22px;
            padding: 18px 16px 16px;
            box-shadow: 0 18px 40px rgba(0,0,0,0.18);
          }

          .ao-success-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
          }

          .ao-success-icon {
            font-size: 42px;
            color: #39a84b;
          }

          .ao-success-x {
            border: 0;
            background: transparent;
            color: #111111;
            font-size: 20px;
            cursor: pointer;
          }

          .ao-success-title {
            font-size: 20px;
            font-weight: 900;
            margin-bottom: 8px;
            color: #111111;
          }

          .ao-success-msg {
            font-size: 14px;
            line-height: 1.5;
            color: #333333;
            margin-bottom: 14px;
          }

          .ao-success-btn {
            --background: #39a84b;
            --background-hover: #2f8f3f;
            --background-activated: #2f8f3f;
            --color: #ffffff;
            --border-radius: 14px;
            font-weight: 800;
            height: 46px;
          }

          @media (max-width: 480px) {
            .ao-wrapper {
              padding: 14px 10px 24px;
            }

            .ao-card {
              padding: 16px 12px 18px;
              border-radius: 22px;
            }

            .addon-row {
              align-items: stretch;
            }
          }
        `}
      </style>

      <IonContent fullscreen className="login-content ao-page-scroll">
        <div className="leaf leaf-top-left">
          <img src={leaves} className="leaf-img" alt="" />
        </div>
        <div className="leaf leaf-top-right">
          <img src={leaves} className="leaf-img" alt="" />
        </div>
        <div className="leaf leaf-bottom-left">
          <img src={leaves} className="leaf-img" alt="" />
        </div>
        <div className="leaf leaf-bottom-right">
          <img src={leaves} className="leaf-img" alt="" />
        </div>

        <div className="ao-wrapper">
          <div className="ao-card">
            <div className="ao-topbar">
              <IonText className="ao-title">
                {mode === "add_ons" ? "Order" : "Other Items"}
              </IonText>

              <IonButton fill="clear" className="ao-close" onClick={resetForm}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </div>

            <div style={{ marginTop: 6, marginBottom: 10 }}>
              <IonText style={{ fontWeight: 800, display: "block", marginBottom: 6 }}>
                Type
              </IonText>

              <IonSegment
                value={mode}
                onIonChange={(e) => {
                  const v = asString(e.detail.value) as Mode;
                  setMode(v);

                  setSelectedItems([]);
                  setSelectedCategories([""]);
                  setSelectedSizes([""]);

                  setIsPickerOpen(false);
                  setPickerCategory("");
                  setPickerSize("");
                  setPickerSearch("");
                }}
              >
                <IonSegmentButton value="add_ons">
                  <IonLabel>Order</IonLabel>
                </IonSegmentButton>

                <IonSegmentButton value="consignment">
                  <IonLabel>Other Items</IonLabel>
                </IonSegmentButton>
              </IonSegment>
            </div>

            {isLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
                <IonSpinner />
              </div>
            ) : null}

            <IonItem className="ao-form-item">
              <IonLabel position="stacked">Full Name *</IonLabel>
              <IonInput
                value={fullName}
                placeholder="Enter full name"
                onIonChange={(e) => setFullName(e.detail.value ?? "")}
              />
            </IonItem>

            <IonItem className="ao-form-item">
              <IonLabel position="stacked">Seat Number *</IonLabel>
              <IonSelect
                value={seat}
                placeholder="Choose seat"
                onIonChange={(e) => setSeat(asString(e.detail.value))}
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

            <IonItem className="ao-form-item">
              <IonLabel position="stacked">Booking Code *</IonLabel>
              <IonInput
                value={bookingCode}
                maxlength={4}
                placeholder="Enter 4-character code"
                onIonInput={(e) => {
                  const raw = asString(e.detail.value);
                  setBookingCode(normalizeBookingCode(raw));
                }}
              />
            </IonItem>

            {selectedCategories.map((category, index) => {
              const hasSizes = categoryHasSizes(category);
              const sizeOptions = hasSizes ? getSizesForCategory(category) : [];
              const pickedSize = (selectedSizes[index] ?? "").trim();

              return (
                <div key={`cat-${index}`} className="addon-block">
                  <div className="addon-row">
                    <IonItem className="ao-form-item ao-form-item-compact addon-flex">
                      <IonLabel position="stacked">Select Category {index + 1}</IonLabel>
                      <IonSelect
                        value={category}
                        placeholder="Choose a category"
                        onIonChange={(e) =>
                          handleCategoryChange(index, asString(e.detail.value))
                        }
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
                    <IonItem
                      className="ao-form-item ao-form-item-compact"
                      style={{ marginTop: 10 }}
                    >
                      <IonLabel position="stacked">Select Size</IonLabel>
                      <IonSelect
                        value={pickedSize}
                        placeholder="Choose size"
                        onIonChange={(e) =>
                          handleSizeChange(index, asString(e.detail.value))
                        }
                      >
                        {sizeOptions.map((sz) => (
                          <IonSelectOption
                            key={`${category}-${sz}-${index}`}
                            value={sz}
                          >
                            {sz}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonItem>
                  ) : null}

                  {category && hasSizes && !pickedSize ? (
                    <IonItem
                      className="ao-form-item ao-form-item-compact"
                      lines="none"
                      style={{ marginTop: 8 }}
                    >
                      <IonLabel style={{ opacity: 0.85 }}>
                        Select a size first to show items.
                      </IonLabel>
                    </IonItem>
                  ) : null}
                </div>
              );
            })}

            {isPickerOpen ? (
              <div className="ao-picker" style={{ marginTop: 12 }}>
                <div className="ao-picker-head">
                  <IonText>
                    <strong>
                      Choose Item {pickerCategory ? `- ${pickerCategory}` : ""}{" "}
                      {pickerSize ? `(${pickerSize})` : ""}
                    </strong>
                  </IonText>

                  <IonButton fill="clear" onClick={() => setIsPickerOpen(false)}>
                    <IonIcon icon={closeOutline} />
                  </IonButton>
                </div>

                <IonSearchbar
                  value={pickerSearch}
                  onIonInput={(e) => setPickerSearch(asString(e.detail.value))}
                  placeholder="Search item name..."
                />

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
                              <div
                                style={{
                                  width: 56,
                                  height: 56,
                                  borderRadius: 10,
                                  background: "#eee",
                                }}
                              />
                            )}
                          </IonThumbnail>

                          <IonLabel>
                            <div style={{ fontWeight: 800 }}>{a.name}</div>
                            {cleanSize(a.size) ? (
                              <div style={{ opacity: 0.85 }}>
                                Size: {cleanSize(a.size)}
                              </div>
                            ) : null}
                            <div style={{ marginTop: 4 }}>
                              ₱{toNum(a.price)} • Remaining:{" "}
                              <strong>{remaining}</strong>
                            </div>
                          </IonLabel>
                        </IonItem>
                      );
                    })}
                  </IonList>
                )}
              </div>
            ) : null}

            {selectedItems.length > 0 ? (
              <IonList style={{ marginTop: 12 }}>
                <IonListHeader>
                  <IonLabel>Selected Items</IonLabel>
                </IonListHeader>

                {selectedSummaryByCategory.map(({ category: catTitle, items: block }) => (
                  <React.Fragment key={catTitle}>
                    <IonListHeader>
                      <IonLabel>
                        <strong>{catTitle}</strong>
                      </IonLabel>
                    </IonListHeader>

                    {block.map((selected) => {
                      const stocks = Math.max(
                        0,
                        Math.floor(toNum(stocksById.get(selected.id) ?? 0))
                      );

                      const remainingIfKeepQty = Math.max(
                        0,
                        stocks - selected.quantity
                      );

                      return (
                        <IonItem key={selected.id} className="addon-item">
                          <IonThumbnail slot="start" style={{ width: 46, height: 46 }}>
                            {selected.image_url ? (
                              <IonImg src={selected.image_url} alt={selected.name} />
                            ) : (
                              <div
                                style={{
                                  width: 46,
                                  height: 46,
                                  borderRadius: 10,
                                  background: "#eee",
                                }}
                              />
                            )}
                          </IonThumbnail>

                          <IonLabel>
                            <div style={{ fontWeight: 700 }}>
                              {selected.name}{" "}
                              {cleanSize(selected.size) ? (
                                <span style={{ opacity: 0.85 }}>
                                  ({cleanSize(selected.size)})
                                </span>
                              ) : null}
                            </div>

                            <div style={{ opacity: 0.85 }}>₱{selected.price}</div>

                            <div style={{ marginTop: 4, fontWeight: 700 }}>
                              Subtotal: ₱
                              {(selected.price * selected.quantity).toFixed(2)}
                            </div>

                            <div style={{ marginTop: 6, opacity: 0.9 }}>
                              Remaining after this qty:{" "}
                              <strong>{remainingIfKeepQty}</strong>
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
                                handleQuantityChange(
                                  selected.id,
                                  Number.isNaN(v) ? 0 : v
                                );
                              }}
                            />

                            <IonButton
                              color="danger"
                              onClick={() =>
                                setSelectedItems((prev) =>
                                  prev.filter((s) => s.id !== selected.id)
                                )
                              }
                            >
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

            <IonButton expand="block" className="ao-primary" onClick={addAnotherCategory}>
              Add More {mode === "add_ons" ? "Order" : "Other Items"}
            </IonButton>

            <IonButton
              expand="block"
              className="ao-primary"
              disabled={isLoading}
              onClick={() => void handleSubmit()}
            >
              {isLoading ? "Saving..." : "Submit Order"}
            </IonButton>

            <IonButton
              expand="block"
              fill="solid"
              className="btn-green"
              onClick={resetForm}
              style={{
                marginTop: 8,
                height: 46,
                "--background": "#39a84b",
                "--background-hover": "#2f8f3f",
                "--background-activated": "#2f8f3f",
                "--color": "#ffffff",
                "--border-radius": "12px",
                fontWeight: 900,
                boxShadow: "0 10px 18px rgba(57,168,75,0.25)",
              }}
            >
              Reset
            </IonButton>
          </div>
        </div>

        <IonModal
          isOpen={successOpen}
          onDidDismiss={closeSuccess}
          backdropDismiss={true}
          className="ao-success-modal"
        >
          <div className="ao-success-box">
            <div className="ao-success-top">
              <IonIcon
                icon={checkmarkCircleOutline}
                className="ao-success-icon"
              />
              <button
                type="button"
                className="ao-success-x"
                onClick={closeSuccess}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="ao-success-title">Order Received</div>
            <div className="ao-success-msg">{SUCCESS_MESSAGE}</div>

            <IonButton expand="block" className="ao-success-btn" onClick={closeSuccess}>
              OK
            </IonButton>
          </div>
        </IonModal>

        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message={toastMsg}
          duration={1600}
          color={toastColor}
        />
      </IonContent>
    </IonPage>
  );
};

export default Add_Ons;