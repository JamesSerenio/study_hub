// Admin_Item_Lists.tsx
import React, { useState, useEffect } from "react";
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
}

const Admin_Item_Lists: React.FC = () => {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAddOn, setEditingAddOn] = useState<AddOn | null>(null);

  const fetchAddOns = async () => {
    try {
      const { data, error } = await supabase
        .from("add_ons")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      setAddOns(data || []);
    } catch (error) {
      console.error("Error fetching add-ons:", error);
      setToastMessage("Error loading add-ons. Please try again.");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAddOns();
  }, []);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>) => {
    fetchAddOns().then(() => {
      event.detail.complete();
    });
  };

  const sortedAddOns = [...addOns].sort((a, b) => {
    if (sortOrder === 'asc') {
      return a.category.localeCompare(b.category);
    } else {
      return b.category.localeCompare(a.category);
    }
  });

  const toggleSort = () => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  };

  const handleEdit = (id: string) => {
    const addOnToEdit = addOns.find(addOn => addOn.id === id);
    if (addOnToEdit) {
      setEditingAddOn({ ...addOnToEdit });
      setShowEditModal(true);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingAddOn) return;

    // Validation
    if (!editingAddOn.name.trim()) {
      setToastMessage("Name is required.");
      setShowToast(true);
      return;
    }
    if (!editingAddOn.category.trim()) {
      setToastMessage("Category is required.");
      setShowToast(true);
      return;
    }
    if (isNaN(editingAddOn.price) || editingAddOn.price < 0) {
      setToastMessage("Price must be a valid positive number.");
      setShowToast(true);
      return;
    }
    if (isNaN(editingAddOn.restocked) || editingAddOn.restocked < 0) {
      setToastMessage("Restocked must be a valid non-negative number.");
      setShowToast(true);
      return;
    }
    if (isNaN(editingAddOn.sold) || editingAddOn.sold < 0) {
      setToastMessage("Sold must be a valid non-negative number.");
      setShowToast(true);
      return;
    }
    if (isNaN(editingAddOn.expenses) || editingAddOn.expenses < 0) {
      setToastMessage("Expenses must be a valid non-negative number.");
      setShowToast(true);
      return;
    }

    try {
      const { error } = await supabase
        .from("add_ons")
        .update({
          category: editingAddOn.category,
          name: editingAddOn.name,
          price: editingAddOn.price,
          restocked: editingAddOn.restocked,
          sold: editingAddOn.sold,
          expenses: editingAddOn.expenses,
        })
        .eq("id", editingAddOn.id);

      if (error) {
        throw error;
      }

      setAddOns(addOns.map(addOn => addOn.id === editingAddOn.id ? editingAddOn : addOn));
      setToastMessage("Add-on updated successfully.");
      setShowToast(true);
      setShowEditModal(false);
      setEditingAddOn(null);
    } catch (error) {
      console.error("Error updating add-on:", error);
      setToastMessage(`Error updating add-on: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
    setShowDeleteAlert(true);
  };

  const confirmDelete = async () => {
    if (deleteId) {
      try {
        const { error } = await supabase
          .from("add_ons")
          .delete()
          .eq("id", deleteId);

        if (error) {
          throw error;
        }

        setAddOns(addOns.filter(addOn => addOn.id !== deleteId));
        setToastMessage("Add-on deleted successfully.");
        setShowToast(true);
      } catch (error) {
        console.error("Error deleting add-on:", error);
        setToastMessage(`Error deleting add-on: ${error instanceof Error ? error.message : "Please try again."}`);
        setShowToast(true);
      }
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
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {loading ? (
          <IonLabel>Loading add-ons...</IonLabel>
        ) : (
          <>
            <IonButton fill="clear" onClick={toggleSort}>
              Sort by Category {sortOrder === 'asc' ? <IonIcon icon={arrowUp} /> : <IonIcon icon={arrowDown} />}
            </IonButton>
            <IonGrid>
              <IonRow>
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
            {
              text: "Cancel",
              role: "cancel",
              handler: () => setShowDeleteAlert(false),
            },
            {
              text: "Delete",
              role: "destructive",
              handler: confirmDelete,
            },
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
                    onIonChange={(e) => setEditingAddOn({ ...editingAddOn, name: e.detail.value! })}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Category</IonLabel>
                  <IonInput
                    value={editingAddOn.category}
                    onIonChange={(e) => setEditingAddOn({ ...editingAddOn, category: e.detail.value! })}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Price</IonLabel>
                  <IonInput
                    type="number"
                    value={editingAddOn.price}
                    onIonChange={(e) => setEditingAddOn({ ...editingAddOn, price: parseFloat(e.detail.value!) || 0 })}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Restocked</IonLabel>
                  <IonInput
                    type="number"
                    value={editingAddOn.restocked}
                    onIonChange={(e) => setEditingAddOn({ ...editingAddOn, restocked: parseInt(e.detail.value!) || 0 })}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Sold</IonLabel>
                  <IonInput
                    type="number"
                    value={editingAddOn.sold}
                    onIonChange={(e) => setEditingAddOn({ ...editingAddOn, sold: parseInt(e.detail.value!) || 0 })}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Expenses</IonLabel>
                  <IonInput
                    type="number"
                    value={editingAddOn.expenses}
                    onIonChange={(e) => setEditingAddOn({ ...editingAddOn, expenses: parseFloat(e.detail.value!) || 0 })}
                  />
                </IonItem>
                <IonButton expand="full" onClick={handleSaveEdit}>Save Changes</IonButton>
                <IonButton expand="full" fill="clear" onClick={() => setShowEditModal(false)}>Cancel</IonButton>
              </>
            )}
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Item_Lists;