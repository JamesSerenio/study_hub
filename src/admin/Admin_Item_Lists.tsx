// Admin_Item_Lists.tsx
// ✅ When replacing image: upload new -> update DB -> delete old file from Storage (auto delete old)
// ✅ No "any"

import React, { useEffect, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonLabel,
  IonButton,
  IonIcon,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
  IonAlert,
  IonModal,
  IonInput,
  IonItem,
  IonImg,
} from "@ionic/react";
import { trash, create, arrowUp, arrowDown } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

interface AddOn {
  id: string;
  category: string;
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

const BUCKET = "add-ons";

const Admin_Item_Lists: React.FC = () => {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [showDeleteAlert, setShowDeleteAlert] = useState<boolean>(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editingAddOn, setEditingAddOn] = useState<AddOn | null>(null);

  const [newImageFile, setNewImageFile] = useState<File | null>(null);

  const fetchAddOns = async (): Promise<void> => {
    try {
      const { data, error } = await supabase
        .from("add_ons")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setAddOns((data as AddOn[]) || []);
    } catch (error: unknown) {
      console.error("Error fetching add-ons:", error);
      setToastMessage("Error loading add-ons. Please try again.");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAddOns();
  }, []);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>): void => {
    void fetchAddOns().then(() => event.detail.complete());
  };

  const sortedAddOns = [...addOns].sort((a, b) => {
    const aCat = a.category ?? "";
    const bCat = b.category ?? "";
    return sortOrder === "asc" ? aCat.localeCompare(bCat) : bCat.localeCompare(aCat);
  });

  const toggleSort = (): void => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
  };

  const handleEdit = (id: string): void => {
    const addOnToEdit = addOns.find((a) => a.id === id);
    if (!addOnToEdit) return;
    setEditingAddOn({ ...addOnToEdit });
    setNewImageFile(null);
    setShowEditModal(true);
  };

  // ✅ Extract bucket path from public URL
  // Works for URLs like:
  // https://xxxxx.supabase.co/storage/v1/object/public/add-ons/<path>
  const getStoragePathFromPublicUrl = (publicUrl: string, bucket: string): string | null => {
    try {
      const marker = `/storage/v1/object/public/${bucket}/`;
      const idx = publicUrl.indexOf(marker);
      if (idx === -1) return null;

      const pathWithMaybeQuery = publicUrl.substring(idx + marker.length);
      const path = pathWithMaybeQuery.split("?")[0];
      return decodeURIComponent(path);
    } catch {
      return null;
    }
  };

  const uploadNewImage = async (): Promise<{ publicUrl: string; newPath: string }> => {
    if (!newImageFile) throw new Error("No image selected");

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    if (!userRes?.user) throw new Error("Not logged in");

    const userId: string = userRes.user.id;

    const extRaw: string | undefined = newImageFile.name.split(".").pop();
    const fileExt: string = (extRaw ? extRaw.toLowerCase() : "jpg").trim();
    const fileName: string = `${Date.now()}.${fileExt}`;

    const newPath: string = `${userId}/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(newPath, newImageFile, {
        contentType: newImageFile.type,
        upsert: false,
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(newPath);

    return { publicUrl: urlData.publicUrl, newPath };
  };

  const deleteOldImageIfAny = async (oldImageUrl: string | null): Promise<void> => {
    if (!oldImageUrl) return;

    const oldPath = getStoragePathFromPublicUrl(oldImageUrl, BUCKET);
    if (!oldPath) return;

    // needs Storage delete policy (remove)
    const { error } = await supabase.storage.from(BUCKET).remove([oldPath]);
    if (error) {
      // don't block saving if delete fails
      console.warn("Failed to delete old image:", error.message);
    }
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (!editingAddOn) return;

    // Validation
    if (!editingAddOn.name.trim()) return setToastMessage("Name is required."), setShowToast(true);
    if (!editingAddOn.category.trim()) return setToastMessage("Category is required."), setShowToast(true);
    if (Number.isNaN(editingAddOn.price) || editingAddOn.price < 0)
      return setToastMessage("Price must be a valid positive number."), setShowToast(true);
    if (Number.isNaN(editingAddOn.restocked) || editingAddOn.restocked < 0)
      return setToastMessage("Restocked must be a valid non-negative number."), setShowToast(true);
    if (Number.isNaN(editingAddOn.sold) || editingAddOn.sold < 0)
      return setToastMessage("Sold must be a valid non-negative number."), setShowToast(true);
    if (Number.isNaN(editingAddOn.expenses) || editingAddOn.expenses < 0)
      return setToastMessage("Expenses must be a valid non-negative number."), setShowToast(true);

    const oldImageUrl: string | null = editingAddOn.image_url ?? null;

    try {
      // ✅ if user chose new image: upload first
      let finalImageUrl: string | null = oldImageUrl;

      if (newImageFile) {
        const uploaded = await uploadNewImage();
        finalImageUrl = uploaded.publicUrl;
      }

      // ✅ update DB
      const { error } = await supabase
        .from("add_ons")
        .update({
          category: editingAddOn.category,
          name: editingAddOn.name,
          price: editingAddOn.price,
          restocked: editingAddOn.restocked,
          sold: editingAddOn.sold,
          expenses: editingAddOn.expenses,
          image_url: finalImageUrl,
        })
        .eq("id", editingAddOn.id);

      if (error) throw error;

      // ✅ after successful DB update: delete old image (only if replaced)
      if (newImageFile && finalImageUrl && finalImageUrl !== oldImageUrl) {
        await deleteOldImageIfAny(oldImageUrl);
      }

      const updated: AddOn = { ...editingAddOn, image_url: finalImageUrl };

      setAddOns((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));

      setToastMessage("Add-on updated successfully.");
      setShowToast(true);

      setShowEditModal(false);
      setEditingAddOn(null);
      setNewImageFile(null);
    } catch (error: unknown) {
      console.error("Error updating add-on:", error);
      setToastMessage(
        `Error updating add-on: ${error instanceof Error ? error.message : "Please try again."}`
      );
      setShowToast(true);
    }
  };

  const handleDelete = (id: string): void => {
    setDeleteId(id);
    setShowDeleteAlert(true);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteId) {
      setShowDeleteAlert(false);
      return;
    }

    try {
      const { error } = await supabase.from("add_ons").delete().eq("id", deleteId);
      if (error) throw error;

      setAddOns((prev) => prev.filter((a) => a.id !== deleteId));
      setToastMessage("Add-on deleted successfully.");
      setShowToast(true);
    } catch (error: unknown) {
      console.error("Error deleting add-on:", error);
      setToastMessage(
        `Error deleting add-on: ${error instanceof Error ? error.message : "Please try again."}`
      );
      setShowToast(true);
    }

    setShowDeleteAlert(false);
    setDeleteId(null);
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Admin Item Lists</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <IonLabel>Loading add-ons...</IonLabel>
        ) : (
          <>
            <IonButton fill="clear" onClick={toggleSort}>
              Sort by Category{" "}
              {sortOrder === "asc" ? <IonIcon icon={arrowUp} /> : <IonIcon icon={arrowDown} />}
            </IonButton>

            <IonGrid>
              <IonRow>
                <IonCol>Image</IonCol>
                <IonCol>Name</IonCol>
                <IonCol>Category</IonCol>
                <IonCol>Price</IonCol>
                <IonCol>Restocked</IonCol>
                <IonCol>Sold</IonCol>
                <IonCol>Stocks</IonCol>
                <IonCol>Expenses</IonCol>
                <IonCol>Overall Sales</IonCol>
                <IonCol>Expected Sales</IonCol>
                <IonCol>Actions</IonCol>
              </IonRow>

              {sortedAddOns.length > 0 ? (
                sortedAddOns.map((addOn) => (
                  <IonRow key={addOn.id}>
                    <IonCol>
                      {addOn.image_url ? (
                        <IonImg
                          src={addOn.image_url}
                          alt={addOn.name}
                          style={{ width: "50px", height: "50px", objectFit: "cover" }}
                        />
                      ) : (
                        <IonLabel>No Image</IonLabel>
                      )}
                    </IonCol>
                    <IonCol>{addOn.name}</IonCol>
                    <IonCol>{addOn.category}</IonCol>
                    <IonCol>₱{addOn.price.toFixed(2)}</IonCol>
                    <IonCol>{addOn.restocked}</IonCol>
                    <IonCol>{addOn.sold}</IonCol>
                    <IonCol>{addOn.stocks}</IonCol>
                    <IonCol>₱{addOn.expenses.toFixed(2)}</IonCol>
                    <IonCol>₱{addOn.overall_sales.toFixed(2)}</IonCol>
                    <IonCol>₱{addOn.expected_sales.toFixed(2)}</IonCol>
                    <IonCol>
                      <IonButton fill="clear" onClick={() => handleEdit(addOn.id)}>
                        <IonIcon icon={create} />
                      </IonButton>
                      <IonButton fill="clear" color="danger" onClick={() => handleDelete(addOn.id)}>
                        <IonIcon icon={trash} />
                      </IonButton>
                    </IonCol>
                  </IonRow>
                ))
              ) : (
                <IonRow>
                  <IonCol size="12">No add-ons found.</IonCol>
                </IonRow>
              )}
            </IonGrid>
          </>
        )}

        <IonToast
          isOpen={showToast}
          message={toastMessage}
          duration={3000}
          onDidDismiss={() => setShowToast(false)}
        />

        <IonAlert
          isOpen={showDeleteAlert}
          onDidDismiss={() => setShowDeleteAlert(false)}
          header="Confirm Delete"
          message="Are you sure you want to delete this add-on?"
          buttons={[
            { text: "Cancel", role: "cancel", handler: () => setShowDeleteAlert(false) },
            { text: "Delete", role: "destructive", handler: () => void confirmDelete() },
          ]}
        />

        <IonModal isOpen={showEditModal} onDidDismiss={() => setShowEditModal(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Edit Add-On</IonTitle>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            {editingAddOn && (
              <>
                <IonItem>
                  <IonLabel position="stacked">Name</IonLabel>
                  <IonInput
                    value={editingAddOn.name}
                    onIonChange={(e) =>
                      setEditingAddOn({
                        ...editingAddOn,
                        name: (e.detail.value ?? "").toString(),
                      })
                    }
                  />
                </IonItem>

                <IonItem>
                  <IonLabel position="stacked">Category</IonLabel>
                  <IonInput
                    value={editingAddOn.category}
                    onIonChange={(e) =>
                      setEditingAddOn({
                        ...editingAddOn,
                        category: (e.detail.value ?? "").toString(),
                      })
                    }
                  />
                </IonItem>

                {/* ✅ REPLACE IMAGE */}
                <IonItem>
                  <IonLabel position="stacked">Replace Image (optional)</IonLabel>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const files: FileList | null = e.target.files;
                      setNewImageFile(files && files.length > 0 ? files[0] : null);
                    }}
                  />
                </IonItem>

                <IonItem>
                  <IonLabel position="stacked">Current Image</IonLabel>
                  {editingAddOn.image_url ? (
                    <IonImg
                      src={editingAddOn.image_url}
                      alt="current"
                      style={{ width: "120px", height: "120px", objectFit: "cover" }}
                    />
                  ) : (
                    <IonLabel>No Image</IonLabel>
                  )}
                </IonItem>

                <IonItem>
                  <IonLabel position="stacked">Price</IonLabel>
                  <IonInput
                    type="number"
                    value={editingAddOn.price}
                    onIonChange={(e) => {
                      const v = parseFloat((e.detail.value ?? "0").toString());
                      setEditingAddOn({ ...editingAddOn, price: Number.isNaN(v) ? 0 : v });
                    }}
                  />
                </IonItem>

                <IonItem>
                  <IonLabel position="stacked">Restocked</IonLabel>
                  <IonInput
                    type="number"
                    value={editingAddOn.restocked}
                    onIonChange={(e) => {
                      const v = parseInt((e.detail.value ?? "0").toString(), 10);
                      setEditingAddOn({ ...editingAddOn, restocked: Number.isNaN(v) ? 0 : v });
                    }}
                  />
                </IonItem>

                <IonItem>
                  <IonLabel position="stacked">Sold</IonLabel>
                  <IonInput
                    type="number"
                    value={editingAddOn.sold}
                    onIonChange={(e) => {
                      const v = parseInt((e.detail.value ?? "0").toString(), 10);
                      setEditingAddOn({ ...editingAddOn, sold: Number.isNaN(v) ? 0 : v });
                    }}
                  />
                </IonItem>

                <IonItem>
                  <IonLabel position="stacked">Expenses</IonLabel>
                  <IonInput
                    type="number"
                    value={editingAddOn.expenses}
                    onIonChange={(e) => {
                      const v = parseFloat((e.detail.value ?? "0").toString());
                      setEditingAddOn({ ...editingAddOn, expenses: Number.isNaN(v) ? 0 : v });
                    }}
                  />
                </IonItem>

                <IonButton expand="full" onClick={() => void handleSaveEdit()}>
                  Save Changes
                </IonButton>

                <IonButton
                  expand="full"
                  fill="clear"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingAddOn(null);
                    setNewImageFile(null);
                  }}
                >
                  Cancel
                </IonButton>
              </>
            )}
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Item_Lists;
