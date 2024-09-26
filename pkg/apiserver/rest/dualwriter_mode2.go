package rest

import (
	"context"
	"fmt"
	"time"

	"github.com/grafana/authlib/claims"
	"github.com/grafana/grafana/pkg/apimachinery/identity"
	"github.com/grafana/grafana/pkg/apimachinery/utils"
	"github.com/prometheus/client_golang/prometheus"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metainternalversion "k8s.io/apimachinery/pkg/apis/meta/internalversion"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apiserver/pkg/endpoints/request"
	"k8s.io/apiserver/pkg/registry/rest"
	"k8s.io/klog/v2"
)

const mode2Str = "2"

// NewDualWriterMode2 returns a new DualWriter in mode 2.
// Mode 2 represents writing to LegacyStorage and Storage and reading from LegacyStorage.
func newDualWriterMode2(legacy LegacyStorage, storage Storage, dwm *dualWriterMetrics, resource string) *DualWriterMode2 {
	return &DualWriterMode2{
		Legacy:            legacy,
		Storage:           storage,
		Log:               klog.NewKlogr().WithName("DualWriterMode2").WithValues("mode", mode2Str, "resource", resource),
		dualWriterMetrics: dwm,
		resource:          resource,
	}
}

// Mode returns the mode of the dual writer.
func (d *DualWriterMode2) Mode() DualWriterMode {
	return Mode2
}

// Create overrides the behavior of the generic DualWriter and writes to LegacyStorage and Storage.
func (d *DualWriterMode2) Create(ctx context.Context, in runtime.Object, createValidation rest.ValidateObjectFunc, options *metav1.CreateOptions) (runtime.Object, error) {
	var method = "create"
	log := d.Log.WithValues("method", method)
	ctx = klog.NewContext(ctx, log)

	startLegacy := time.Now()
	createdFromLegacy, err := d.Legacy.Create(ctx, in, createValidation, options)
	if err != nil {
		log.Error(err, "unable to create object in legacy storage")
		d.recordLegacyDuration(true, mode2Str, d.resource, method, startLegacy)
		return createdFromLegacy, err
	}
	d.recordLegacyDuration(false, mode2Str, d.resource, method, startLegacy)

	accIn, err := meta.Accessor(in)
	if err != nil {
		return createdFromLegacy, err
	}
	if accIn.GetUID() != "" {
		return nil, fmt.Errorf("there is an UID and it should not: %v", accIn.GetUID())
	}

	startStorage := time.Now()
	createdFromStorage, err := d.Storage.Create(ctx, in, createValidation, options)
	if err != nil {
		log.WithValues("name").Error(err, "unable to create object in storage")
		d.recordStorageDuration(true, mode2Str, d.resource, method, startStorage)
		return createdFromStorage, err
	}
	d.recordStorageDuration(false, mode2Str, d.resource, method, startStorage)

	areEqual := Compare(createdFromStorage, createdFromLegacy)
	d.recordOutcome(mode2Str, getName(createdFromStorage), areEqual, method)
	if !areEqual {
		log.Info("object from legacy and storage are not equal")
	}

	return createdFromLegacy, err
}

// It retrieves an object from Storage if possible, and if not it falls back to LegacyStorage.
func (d *DualWriterMode2) Get(ctx context.Context, name string, options *metav1.GetOptions) (runtime.Object, error) {
	var method = "get"
	log := d.Log.WithValues("name", name, "resourceVersion", options.ResourceVersion, "method", method)
	ctx = klog.NewContext(ctx, log)

	startStorage := time.Now()
	objStorage, err := d.Storage.Get(ctx, name, options)
	d.recordStorageDuration(err != nil, mode2Str, d.resource, method, startStorage)
	if err != nil {
		// if it errors because it's not found, we try to fetch it from the legacy storage
		if !apierrors.IsNotFound(err) {
			log.Error(err, "unable to fetch object from storage")
			return objStorage, err
		}
		log.Info("object not found in storage, fetching from legacy")
	}

	startLegacy := time.Now()
	objLegacy, err := d.Legacy.Get(ctx, name, options)
	if err != nil {
		log.Error(err, "unable to fetch object from legacy")
		d.recordLegacyDuration(true, mode2Str, d.resource, method, startLegacy)
		return objLegacy, err
	}
	d.recordLegacyDuration(false, mode2Str, d.resource, method, startLegacy)

	areEqual := Compare(objStorage, objLegacy)
	d.recordOutcome(mode2Str, name, areEqual, method)
	if !areEqual {
		log.Info("object from legacy and storage are not equal")
	}

	if objStorage != nil {
		updateRV(objStorage, objLegacy)
	}
	if objStorage != nil {
		if err := updateRV(objStorage, objLegacy); err != nil {
			log.WithValues("storageObject", objStorage, "legacyObject", objLegacy).Error(err, "could not update resource version")
		}
	}

	return objLegacy, err
}

// List overrides the behavior of the generic DualWriter.
// It returns Storage entries if possible and falls back to LegacyStorage entries if not.
func (d *DualWriterMode2) List(ctx context.Context, options *metainternalversion.ListOptions) (runtime.Object, error) {
	var method = "list"
	log := d.Log.WithValues("resourceVersion", options.ResourceVersion, "method", method)
	ctx = klog.NewContext(ctx, log)

	startLegacy := time.Now()
	ll, err := d.Legacy.List(ctx, options)
	if err != nil {
		log.Error(err, "unable to list objects from legacy storage")
		d.recordLegacyDuration(true, mode2Str, d.resource, method, startLegacy)
		return ll, err
	}
	d.recordLegacyDuration(false, mode2Str, d.resource, method, startLegacy)

	legacyList, err := meta.ExtractList(ll)
	if err != nil {
		log.Error(err, "unable to extract list from legacy storage")
		return nil, err
	}

	// Record the index of each LegacyStorage object so it can later be replaced by
	// an equivalent Storage object if it exists.
	legacyNames, err := parseList(legacyList)
	if err != nil {
		return nil, err
	}

	startStorage := time.Now()
	sl, err := d.Storage.List(ctx, options)
	if err != nil {
		log.Error(err, "unable to list objects from storage")
		d.recordStorageDuration(true, mode2Str, d.resource, method, startStorage)
		return sl, err
	}
	d.recordStorageDuration(false, mode2Str, d.resource, method, startStorage)

	storageList, err := meta.ExtractList(sl)
	if err != nil {
		log.Error(err, "unable to extract list from storage")
		return nil, err
	}

	for _, obj := range storageList {
		name := getName(obj)
		if i, ok := legacyNames[name]; ok {
			legacyList[i] = obj
			areEqual := Compare(obj, legacyList[i])
			d.recordOutcome(mode2Str, name, areEqual, method)
			if !areEqual {
				log.WithValues("name", name).Info("object from legacy and storage are not equal")
			}
		}
	}

	if err = meta.SetList(ll, legacyList); err != nil {
		return nil, err
	}

	// always return the list from legacy storage
	return ll, nil
}

// DeleteCollection overrides the behavior of the generic DualWriter and deletes from both LegacyStorage and Storage.
func (d *DualWriterMode2) DeleteCollection(ctx context.Context, deleteValidation rest.ValidateObjectFunc, options *metav1.DeleteOptions, listOptions *metainternalversion.ListOptions) (runtime.Object, error) {
	var method = "delete-collection"
	log := d.Log.WithValues("resourceVersion", listOptions.ResourceVersion, "method", method)
	ctx = klog.NewContext(ctx, log)

	startLegacy := time.Now()
	deletedLegacy, err := d.Legacy.DeleteCollection(ctx, deleteValidation, options, listOptions)
	if err != nil {
		log.WithValues("deleted", deletedLegacy).Error(err, "failed to delete collection successfully from legacy storage")
		d.recordLegacyDuration(true, mode2Str, d.resource, method, startLegacy)
		return deletedLegacy, err
	}
	d.recordLegacyDuration(false, mode2Str, d.resource, method, startLegacy)

	legacyList, err := meta.ExtractList(deletedLegacy)
	if err != nil {
		log.Error(err, "unable to extract list from legacy storage")
		return nil, err
	}

	// Only the items deleted by the legacy DeleteCollection call are selected for deletion by Storage.
	_, err = parseList(legacyList)
	if err != nil {
		return nil, err
	}

	startStorage := time.Now()
	deletedStorage, err := d.Storage.DeleteCollection(ctx, deleteValidation, options, listOptions)
	if err != nil {
		log.WithValues("deleted", deletedStorage).Error(err, "failed to delete collection successfully from Storage")
		d.recordStorageDuration(true, mode2Str, d.resource, method, startStorage)
		return deletedStorage, err
	}
	d.recordStorageDuration(false, mode2Str, d.resource, method, startStorage)

	areEqual := Compare(deletedStorage, deletedLegacy)
	d.recordOutcome(mode2Str, getName(deletedStorage), areEqual, method)
	if !areEqual {
		log.Info("object from legacy and storage are not equal")
	}

	return deletedLegacy, err
}

func (d *DualWriterMode2) Delete(ctx context.Context, name string, deleteValidation rest.ValidateObjectFunc, options *metav1.DeleteOptions) (runtime.Object, bool, error) {
	var method = "delete"
	log := d.Log.WithValues("name", name, "method", method)
	ctx = klog.NewContext(ctx, log)

	startStorage := time.Now()
	deletedS, async, err := d.Storage.Delete(ctx, name, deleteValidation, options)
	if err != nil {
		if !apierrors.IsNotFound(err) {
			log.WithValues("objectList", deletedS).Error(err, "could not delete from duplicate storage")
			d.recordStorageDuration(true, mode2Str, d.resource, method, startStorage)
		}
		return deletedS, async, err
	}
	d.recordStorageDuration(false, mode2Str, d.resource, method, startStorage)

	startLegacy := time.Now()
	deletedLS, async, err := d.Legacy.Delete(ctx, name, deleteValidation, options)

	if err != nil {
		if !apierrors.IsNotFound(err) {
			log.WithValues("objectList", deletedLS).Error(err, "could not delete from legacy store")
			d.recordLegacyDuration(true, mode2Str, d.resource, method, startLegacy)
			return deletedLS, async, err
		}
	}
	d.recordLegacyDuration(false, mode2Str, d.resource, method, startLegacy)

	areEqual := Compare(deletedS, deletedLS)
	d.recordOutcome(mode2Str, name, areEqual, method)
	if !areEqual {
		log.WithValues("name", name).Info("object from legacy and storage are not equal")
	}

	return deletedLS, async, err
}

// Update overrides the generic behavior of the Storage and writes first to the legacy storage and then to storage.
func (d *DualWriterMode2) Update(ctx context.Context, name string, objInfo rest.UpdatedObjectInfo, createValidation rest.ValidateObjectFunc, updateValidation rest.ValidateObjectUpdateFunc, forceAllowCreate bool, options *metav1.UpdateOptions) (runtime.Object, bool, error) {
	var method = "update"
	log := d.Log.WithValues("name", name, "method", method)
	ctx = klog.NewContext(ctx, log)

	startLegacy := time.Now()
	objFromLegacy, created, err := d.Legacy.Update(ctx, name, objInfo, createValidation, updateValidation, forceAllowCreate, options)
	if err != nil {
		log.WithValues("object", objFromLegacy).Error(err, "could not update in legacy storage")
		d.recordLegacyDuration(true, mode2Str, d.resource, "update", startLegacy)
		return objFromLegacy, created, err
	}
	d.recordLegacyDuration(false, mode2Str, d.resource, "update", startLegacy)

	startStorage := time.Now()
	objFromStorage, created, err := d.Storage.Update(ctx, name, objInfo, createValidation, updateValidation, forceAllowCreate, options)
	if err != nil {
		log.WithValues("object", objFromStorage).Error(err, "could not update in storage")
		d.recordStorageDuration(true, mode2Str, d.resource, "update", startStorage)
		return objFromStorage, created, err
	}

	areEqual := Compare(objFromStorage, objFromLegacy)
	d.recordOutcome(mode2Str, name, areEqual, method)
	if !areEqual {
		log.WithValues("name", name).Info("object from legacy and storage are not equal")
	}

	if objFromStorage != nil {
		if err := updateRV(objFromStorage, objFromLegacy); err != nil {
			log.WithValues("storageObject", objFromStorage, "legacyObject", objFromLegacy).Error(err, "could not update resource version")
		}
	}

	return objFromLegacy, created, err
}

func updateRV(storageObj runtime.Object, legacyObj runtime.Object) error {
	storageAccessor, err := utils.MetaAccessor(storageObj)
	if err != nil {
		return err
	}
	legacyAccessor, err := utils.MetaAccessor(legacyObj)
	if err != nil {
		return err
	}

	legacyAccessor.SetResourceVersion(storageAccessor.GetResourceVersion())
	return nil
}

func (d *DualWriterMode2) Destroy() {
	d.Storage.Destroy()
	d.Legacy.Destroy()
}

func (d *DualWriterMode2) GetSingularName() string {
	return d.Storage.GetSingularName()
}

func (d *DualWriterMode2) NamespaceScoped() bool {
	return d.Storage.NamespaceScoped()
}

func (d *DualWriterMode2) New() runtime.Object {
	return d.Storage.New()
}

func (d *DualWriterMode2) NewList() runtime.Object {
	return d.Storage.NewList()
}

func (d *DualWriterMode2) ConvertToTable(ctx context.Context, object runtime.Object, tableOptions runtime.Object) (*metav1.Table, error) {
	return d.Storage.ConvertToTable(ctx, object, tableOptions)
}

func parseList(legacyList []runtime.Object) (map[string]int, error) {
	indexMap := map[string]int{}

	for i, obj := range legacyList {
		accessor, err := utils.MetaAccessor(obj)
		if err != nil {
			return nil, err
		}
		indexMap[accessor.GetName()] = i
	}
	return indexMap, nil
}

func addLabelsAndAnnotations(fromObj, toObj runtime.Object) error {
	accToObj, err := meta.Accessor(toObj)
	if err != nil {
		return err
	}

	accFromObj, err := meta.Accessor(fromObj)
	if err != nil {
		return err
	}

	accToObj.SetLabels(accFromObj.GetLabels())

	ac := accToObj.GetAnnotations()
	if ac == nil {
		ac = map[string]string{}
	}
	for k, v := range accFromObj.GetAnnotations() {
		ac[k] = v
	}
	accToObj.SetAnnotations(ac)

	// if isCreated {
	// 	accessorReturned.SetResourceVersion("")
	// 	// accessorReturned.SetUID("")
	// } else {
	// 	accessorReturned.SetResourceVersion(accessorOriginal.GetResourceVersion())
	// }

	// //TODO: think about this
	// // if accessorOriginal.GetUID() != "" {
	// // 	accessorReturned.SetUID(accessorOriginal.GetUID())
	// // }

	// fmt.Printf("OBJ RV 1: %v\n", accessorReturned.GetResourceVersion())
	// o, err := meta.Accessor(returnedObj)
	// if err != nil {
	// 	return err
	// }
	// fmt.Printf("OBJ RV 2: %v\n", o.GetResourceVersion())

	return nil
}

func getSyncRequester(orgId int64) *identity.StaticRequester {
	return &identity.StaticRequester{
		Type:           claims.TypeServiceAccount, // system:apiserver
		UserID:         1,
		OrgID:          orgId,
		Name:           "admin",
		Login:          "admin",
		OrgRole:        identity.RoleAdmin,
		IsGrafanaAdmin: true,
		Permissions: map[int64]map[string][]string{
			orgId: {
				"*": {"*"}, // all resources, all scopes
			},
		},
	}
}

type syncItem struct {
	name       string
	objStorage runtime.Object
	objLegacy  runtime.Object
}

func getList(ctx context.Context, obj rest.Lister, listOptions *metainternalversion.ListOptions) ([]runtime.Object, error) {
	ll, err := obj.List(ctx, listOptions)
	if err != nil {
		return nil, err
	}

	return meta.ExtractList(ll)
}

func mode2DataSyncer(ctx context.Context, legacy LegacyStorage, storage Storage, resource string, reg prometheus.Registerer, serverLockService ServerLockService, requestInfo *request.RequestInfo) (bool, error) {
	metrics := &dualWriterMetrics{}
	metrics.init(reg)

	log := klog.NewKlogr().WithName("DualWriterMode2Syncer")

	everythingSynced := false
	outOfSync := 0
	syncSuccess := 0
	syncErr := 0

	maxInterval := dataSyncerInterval + 5*time.Minute

	var errSync error
	const maxRecordsSync = 1000

	// LockExecuteAndRelease ensures that just a single Grafana server acquires a lock at a time
	// The parameter 'maxInterval' is a timeout safeguard, if the LastExecution in the
	// database is older than maxInterval, we will assume the lock as timeouted. The 'maxInterval' parameter should be so long
	// that is impossible for 2 processes to run at the same time.
	err := serverLockService.LockExecuteAndRelease(ctx, "dualwriter mode 2 sync", maxInterval, func(context.Context) {
		log.Info("starting dualwriter mode 2 sync")
		startSync := time.Now()

		orgId := int64(1)

		ctx = klog.NewContext(ctx, log)
		ctx = identity.WithRequester(ctx, getSyncRequester(orgId))
		ctx = request.WithNamespace(ctx, requestInfo.Namespace)
		ctx = request.WithRequestInfo(ctx, requestInfo)

		storageList, err := getList(ctx, storage, &metainternalversion.ListOptions{
			Limit: maxRecordsSync,
		})
		if err != nil {
			log.Error(err, "unable to extract list from storage")
			return
		}

		if len(storageList) >= maxRecordsSync {
			errSync = fmt.Errorf("unified storage has more than %d records. Aborting sync", maxRecordsSync)
			log.Error(errSync, "Unified storage has more records to be synced than allowed")
			return
		}

		log.Info("got items from unified storage", "items", len(storageList))

		legacyList, err := getList(ctx, legacy, &metainternalversion.ListOptions{})
		if err != nil {
			log.Error(err, "unable to extract list from legacy storage")
			return
		}
		log.Info("got items from legacy storage", "items", len(legacyList))

		itemsByName := map[string]syncItem{}
		for _, obj := range legacyList {
			accessor, err := utils.MetaAccessor(obj)
			if err != nil {
				log.Error(err, "error retrieving accessor data for object from legacy storage")
				continue
			}
			name := accessor.GetName()

			item, ok := itemsByName[name]
			if !ok {
				item = syncItem{}
			}
			item.name = name
			item.objLegacy = obj
			itemsByName[name] = item
		}

		for _, obj := range storageList {
			accessor, err := utils.MetaAccessor(obj)
			if err != nil {
				log.Error(err, "error retrieving accessor data for object from storage")
				continue
			}
			name := accessor.GetName()

			item, ok := itemsByName[name]
			if !ok {
				item = syncItem{}
			}
			item.name = name
			item.objStorage = obj
			itemsByName[name] = item
		}
		log.Info("got list of items to be synced", "items", len(itemsByName))

		for name, item := range itemsByName {
			// upsert if:
			// - existing in both legacy and storage, but objects are different, or
			// - if it's missing from storage
			if item.objLegacy != nil &&
				((item.objStorage != nil && !Compare(item.objLegacy, item.objStorage)) || (item.objStorage == nil)) {
				outOfSync++

				accessor, err := utils.MetaAccessor(item.objLegacy)
				if err != nil {
					log.Error(err, "error retrieving accessor data for object from storage")
					continue
				}

				if item.objStorage != nil {
					accessorStorage, err := utils.MetaAccessor(item.objStorage)
					if err != nil {
						log.Error(err, "error retrieving accessor data for object from storage")
						continue
					}
					accessor.SetResourceVersion(accessorStorage.GetResourceVersion())
					accessor.SetUID(accessorStorage.GetUID())

					log.Info("updating item on unified storage", "name", name)
				} else {
					accessor.SetResourceVersion("")
					accessor.SetUID("")

					log.Info("inserting item on unified storage", "name", name)
				}

				objInfo := rest.DefaultUpdatedObjectInfo(item.objLegacy, []rest.TransformFunc{}...)
				res, _, err := storage.Update(ctx,
					name,
					objInfo,
					func(ctx context.Context, obj runtime.Object) error { return nil },
					func(ctx context.Context, obj, old runtime.Object) error { return nil },
					true, // force creation
					&metav1.UpdateOptions{},
				)
				if err != nil {
					log.WithValues("object", res).Error(err, "could not update in storage")
					syncErr++
				} else {
					syncSuccess++
				}
			}

			// delete if object does not exists on legacy but exists on storage
			if item.objLegacy == nil && item.objStorage != nil {
				outOfSync++

				ctx = request.WithRequestInfo(ctx, &request.RequestInfo{
					APIGroup:  requestInfo.APIGroup,
					Resource:  requestInfo.Resource,
					Name:      name,
					Namespace: requestInfo.Namespace,
				})

				log.Info("deleting item from unified storage", "name", name)

				deletedS, _, err := storage.Delete(ctx, name, func(ctx context.Context, obj runtime.Object) error { return nil }, &metav1.DeleteOptions{})
				if err != nil {
					if !apierrors.IsNotFound(err) {
						log.WithValues("objectList", deletedS).Error(err, "could not delete from storage")
					}
					syncErr++
				} else {
					syncSuccess++
				}
			}
		}

		everythingSynced = outOfSync == syncSuccess

		metrics.recordDataSyncerOutcome(mode2Str, resource, everythingSynced)
		metrics.recordDataSyncerDuration(err != nil, mode2Str, resource, startSync)

		log.Info("finished syncing items", "items", len(itemsByName), "updated", syncSuccess, "failed", syncErr, "outcome", everythingSynced)
	})

	if errSync != nil {
		err = errSync
	}

	return everythingSynced, err
}
