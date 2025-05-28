require([
    "esri/Map",
    "esri/views/MapView",
    "esri/layers/GraphicsLayer",
    "esri/Graphic",
    "esri/geometry/Point",
    "esri/geometry/Polygon",
    "esri/symbols/SimpleMarkerSymbol",
    "esri/symbols/SimpleFillSymbol",
    "esri/symbols/SimpleLineSymbol",
    "esri/widgets/Locate",
    "esri/widgets/ScaleBar",
    "esri/geometry/Extent",
    "esri/geometry/geometryEngine"
], function(Map, MapView, GraphicsLayer, Graphic, Point, Polygon, SimpleMarkerSymbol, SimpleFillSymbol, SimpleLineSymbol, Locate, ScaleBar, Extent, geometryEngine) {

    let map, view, plaquesLayer, propertiesLayer;
    let allData = {};
    let filteredFeatures = [];
    let searchResults = [];
    let currentBasemap = 'streets-vector';
    let isLoading = true;

    const topProgressBar = document.getElementById('top-progress-bar');
    const topProgressFill = topProgressBar.querySelector('.progress-fill');

    const symbols = {
        plaque: new SimpleMarkerSymbol({
            color: [231, 76, 60, 0.8],
            size: 12,
            outline: { color: [255, 255, 255, 0.9], width: 2 },
            style: "circle"
        }),
        property: new SimpleFillSymbol({
            color: [52, 152, 219, 0.4],
            outline: new SimpleLineSymbol({ color: [52, 152, 219, 0.8], width: 2, style: "dash" })
        }),
        propertyPoint: new SimpleMarkerSymbol({
             color: [52, 152, 219, 0.8],
             size: 12,
             outline: { color: [255, 255, 255, 0.9], width: 2 },
             style: "square"
        })
    };

    window.initializeApp = function() {
        showLoadingScreen();
        createMap();
        setupEventListeners();

        view.when(() => {
            console.log("MapView is ready. Spatial Reference:", view.spatialReference ? view.spatialReference.wkid : "not set yet");
            loadData()
                .then(() => {
                    console.log("Data loaded and processed.");
                    const urlParamsActed = handleUrlParameters();
                    if (!urlParamsActed && filteredFeatures.length > 0) {
                        zoomToAllFeatures();
                    }
                })
                .catch(err => {
                    console.error("Failed to initialize map app fully due to data load error:", err);
                    isLoading = false;
                    hideTopProgressBar(true);
                    const loadingScreen = document.getElementById('loading-screen');
                    if (loadingScreen && loadingScreen.style.display !== 'none') {
                        loadingScreen.style.opacity = '0';
                        setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
                    }
                });
        }).catch(err => {
            console.error("MapView failed to initialize:", err);
            isLoading = false;
            showToast(window.getTranslatedString('mapApp.toast.mapInitError', { error: err.message }), 'error');
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.style.opacity = '0';
                setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
            }
            hideTopProgressBar(true);
        });
    }

    function showLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        if (!loadingScreen) {
            console.warn("Loading screen element not found. Map section might not be active.");
            return;
        }
        const progressBar = loadingScreen.querySelector('.loading-progress');
        
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 100) progress = 100;
            progressBar.style.width = progress + '%';
            
            if (progress >= 100 && !isLoading) {
                clearInterval(interval);
                setTimeout(() => {
                    loadingScreen.style.opacity = '0';
                    setTimeout(() => {
                        loadingScreen.style.display = 'none';
                        animateMapEntry();
                    }, 500);
                }, 800);
            } else if (progress >= 100 && isLoading) {
                progress = 90; 
            }
        }, 100);
    }

    function createMap() {
        map = new Map({
            basemap: currentBasemap
        });

        view = new MapView({
            container: "map-view",
            map: map,
            center: [-79.5, 43.8],
            zoom: 7,
            constraints: { minZoom: 6, maxZoom: 18 },
            popup: {
                dockEnabled: true,
                dockOptions: { buttonEnabled: false, breakpoint: false },
                highlightEnabled: false
            },
            ui: { components: [] }
        });

        plaquesLayer = new GraphicsLayer({ id: "plaques", title: "Historical Plaques" });
        propertiesLayer = new GraphicsLayer({ id: "properties", title: "Heritage Properties" });
        map.addMany([plaquesLayer, propertiesLayer]);

        setupMapWidgets();
        setupMapEvents();
    }

    function setupMapWidgets() {
        const locateWidget = new Locate({
            view: view,
            useHeadingEnabled: false,
            goToOverride: function(view, options) {
                options.target.scale = 50000;
                return view.goTo(options.target);
            }
        });

        const scaleBar = new ScaleBar({
            view: view,
            unit: "dual",
            container: "scale-bar"
        });
        
        const locateBtn = document.getElementById('locate-btn');
        if (locateBtn) {
            locateBtn.onclick = () => {
                locateWidget.locate().catch(err => {
                    showToast(window.getTranslatedString('mapApp.toast.locationError'), 'error');
                    console.warn("Locate error:", err);
                });
                showToast(window.getTranslatedString('mapApp.toast.locationFind'), 'info');
            };
        }
    }

    function setupMapEvents() {
        view.when(() => {
            view.watch('zoom', (zoom) => {
                const currentZoomEl = document.getElementById('current-zoom');
                if (currentZoomEl) currentZoomEl.textContent = Math.round(zoom);
                updateLayerVisibilityBasedOnZoom(zoom);
                updateDynamicLayerCounts();
            });

            view.watch('extent', () => {
                updateVisibleSitesCount();
                updateDynamicLayerCounts();
            });
        });

        view.on('click', (event) => {
            view.hitTest(event).then((response) => {
                const featureHit = response.results.find(result => 
                    result.graphic && (result.graphic.layer === plaquesLayer || result.graphic.layer === propertiesLayer)
                );
                if (featureHit) {
                    const graphic = featureHit.graphic;
                    if (graphic && graphic.attributes) {
                        showFeaturePopup(graphic);
                    }
                } else {
                    closeFeaturePopup();
                }
            });
        });

        view.on('pointer-move', (event) => {
            view.hitTest(event).then((response) => {
                const featureHit = response.results.find(result => 
                    result.graphic && (result.graphic.layer === plaquesLayer || result.graphic.layer === propertiesLayer)
                );
                if (featureHit) {
                    view.container.style.cursor = 'pointer';
                } else {
                    view.container.style.cursor = 'default';
                }
            });
        });
    }
    
    function updateLayerVisibilityBasedOnZoom(zoom) {
        const size = zoom > 12 ? 14 : zoom > 9 ? 12 : 10;
        
        if (plaquesLayer && plaquesLayer.graphics) {
            plaquesLayer.graphics.forEach(graphic => {
                if (graphic.symbol && graphic.symbol.type === 'simple-marker') {
                    graphic.symbol = graphic.symbol.clone();
                    graphic.symbol.size = size;
                }
            });
        }
        if (propertiesLayer && propertiesLayer.graphics) {
            propertiesLayer.graphics.forEach(graphic => {
                 if (graphic.symbol && graphic.symbol.type === 'simple-marker') {
                    graphic.symbol = graphic.symbol.clone();
                    graphic.symbol.size = size;
                }
            });
        }
    }

    function animateMapEntry() {
        const mapContainer = document.getElementById('map-container');
        if (!mapContainer) return;
        mapContainer.style.transform = 'scale(0.95)';
        mapContainer.style.opacity = '0';
        
        setTimeout(() => {
            mapContainer.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.6s ease-out';
            mapContainer.style.transform = 'scale(1)';
            mapContainer.style.opacity = '1';
        }, 100);
    }

    function showTopProgressBar() {
        if (!topProgressBar) return;
        topProgressBar.classList.add('show');
        topProgressFill.style.width = '0%';
        topProgressFill.style.opacity = '1';
        topProgressFill.style.background = '';
    }

    function updateTopProgressBar(percentage) {
        if (!topProgressBar || !topProgressBar.classList.contains('show')) showTopProgressBar();
        if (!topProgressBar) return;
        percentage = Math.max(0, Math.min(100, percentage));
        topProgressFill.style.width = percentage + '%';
    }

    function hideTopProgressBar(isError = false) {
        if (!topProgressBar) return;
        if (isError) {
            topProgressFill.style.background = 'red';
        }
        if (!isError && parseFloat(topProgressFill.style.width) < 100) {
            topProgressFill.style.width = '100%';
        }

        setTimeout(() => {
            topProgressFill.style.opacity = '0';
            setTimeout(() => {
                topProgressBar.classList.remove('show');
                topProgressFill.style.width = '0%';
            }, 300);
        }, isError ? 1500 : 500);
    }

    function loadData() {
        isLoading = true;
        showTopProgressBar();
        updateTopProgressBar(10);
    
        return fetch('all_data.json')
            .then(response => {
                updateTopProgressBar(30);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then(data => {
                updateTopProgressBar(60);
                allData = data;
                processData();
                updateTopProgressBar(90);
                populateFilters();
                updateStatistics();
                updateDynamicLayerCounts();
                updateTopProgressBar(100);
                showToast(window.getTranslatedString('mapApp.toast.sitesLoadedSuccess'), 'success');
                hideTopProgressBar();
                isLoading = false;
                return true;
            })
            .catch(error => {
                console.error('Error loading data:', error);
                showToast(window.getTranslatedString('mapApp.toast.sitesLoadError', { error: error.message }), 'error');
                hideTopProgressBar(true);
                isLoading = false;
                throw error;
            });
    }

    function processData() {
        let plaquesCount = 0;
        let propertiesCount = 0;
        filteredFeatures = [];

        Object.keys(allData).forEach(dataKey => {
            const dataset = allData[dataKey];
            if (!dataset || !Array.isArray(dataset.placemarks)) {
                console.warn(`Dataset ${dataKey} is missing or has no placemarks array.`);
                return;
            }

            const isPlaquesData = dataKey.toLowerCase().includes('plaque');
            
            dataset.placemarks.forEach(placemark => {
                if (!placemark.geometry) return;

                const feature = createFeature(placemark, isPlaquesData);
                if (feature) {
                    const currentLayer = isPlaquesData ? plaquesLayer : propertiesLayer;
                    if (currentLayer) currentLayer.add(feature); 
                    
                    filteredFeatures.push({
                        graphic: feature,
                        type: isPlaquesData ? 'plaque' : 'property',
                        searchText: getSearchText(placemark, feature.attributes),
                        attributes: feature.attributes
                    });
                    
                    if (isPlaquesData) plaquesCount++;
                    else propertiesCount++;
                }
            });
        });

        const totalPlaquesEl = document.getElementById('total-plaques');
        if (totalPlaquesEl) totalPlaquesEl.textContent = plaquesCount;
        const totalPropertiesEl = document.getElementById('total-properties');
        if (totalPropertiesEl) totalPropertiesEl.textContent = propertiesCount;
        const totalSitesEl = document.getElementById('total-sites');
        if (totalSitesEl) totalSitesEl.textContent = plaquesCount + propertiesCount;
        
        const plaquesLayerCountEl = document.getElementById('plaques-layer-count');
        if(plaquesLayerCountEl) plaquesLayerCountEl.textContent = `(${plaquesCount})`;
        const propertiesLayerCountEl = document.getElementById('properties-layer-count');
        if(propertiesLayerCountEl) propertiesLayerCountEl.textContent = `(${propertiesCount})`;
    }

    function createFeature(placemark, isPlaque) {
        const geometryData = placemark.geometry;
        let esriGeometry;
        let symbolToUse;

        if (!view) { // view object must exist, though spatialReference might not be needed for geometry creation with WGS84
            console.warn("View not ready for creating feature. Feature will not be created:", placemark.name);
            return null;
        }

        if (geometryData.type === 'Point') {
            esriGeometry = new Point({ // Assumes WGS84 (lon/lat) if no SR specified, which is correct for input
                longitude: geometryData.coordinates.longitude,
                latitude: geometryData.coordinates.latitude
            });
            symbolToUse = isPlaque ? symbols.plaque : symbols.propertyPoint;
        } else if (geometryData.type === 'Polygon' && Array.isArray(geometryData.coordinates) && geometryData.coordinates.length > 0) {
            const rings = [geometryData.coordinates.map(coord => [coord.longitude, coord.latitude])];
             if (rings[0].length < 3) {
                console.warn("Skipping polygon with insufficient coordinates:", placemark.name);
                return null;
            }
            esriGeometry = new Polygon({ rings: rings, spatialReference: { wkid: 4326 } }); // Use WGS84 for lon/lat coordinates
            symbolToUse = symbols.property;
        } else {
            console.warn("Unsupported or invalid geometry type for placemark:", placemark.name, geometryData);
            return null;
        }

        const parsedInfo = parseDescriptionHTML(placemark.description);
        const attributes = {
            name: parsedInfo.title || placemark.name || 'Unnamed Site',
            location: parsedInfo.location || '',
            city: parsedInfo.city || '',
            description: placemark.description || '',
            type: isPlaque ? window.getTranslatedString('mapApp.filterPanel.plaques') : window.getTranslatedString('mapApp.filterPanel.properties'),
            originalData: placemark
        };

        return new Graphic({
            geometry: esriGeometry,
            symbol: symbolToUse,
            attributes: attributes
        });
    }

    function parseDescriptionHTML(htmlString) {
        const data = { title: '', location: '', city: '' };
        if (!htmlString || typeof htmlString !== 'string') return data;

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'text/html');
            
            const tds = doc.querySelectorAll('td');
            let potentialTitle = '';
            let potentialLocation = '';
            let potentialCity = '';

            tds.forEach((td, index) => {
                const key = td.textContent.trim().toLowerCase();
                const nextTd = tds[index + 1];
                if (nextTd) {
                    const value = nextTd.textContent.trim();
                    if (key.includes('title') || key.includes('property name')) potentialTitle = value;
                    else if (key.includes('location') && !key.includes('physical location')) potentialLocation = value;
                    else if (key.includes('city') || key.includes('community') || key.includes('municipality')) potentialCity = value;
                }
            });
            
            data.title = potentialTitle;
            data.location = potentialLocation;
            data.city = potentialCity;

            if (!data.title) {
                const headerTitle = doc.querySelector('body > table > tr:nth-child(1) > td b, body > table > tr:nth-child(1) > td strong');
                if (headerTitle) data.title = headerTitle.textContent.trim();
            }
        } catch (e) {
            console.error("Error parsing description HTML:", e, htmlString.substring(0,100));
        }
        return data;
    }
    
    function getSearchText(placemark, attributes) {
        return [
            attributes.name,
            attributes.location,
            attributes.city,
        ].join(' ').toLowerCase();
    }

    function setupEventListeners() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const panelId = e.currentTarget.id.replace('-btn', '-panel');
                const panel = document.getElementById(panelId);
                
                if (!panel) {
                    if (e.currentTarget.id === 'share-map-btn') {
                        shareMapView();
                    }
                    return;
                }
                
                const isCurrentlyOpen = panel.classList.contains('open');

                if (isCurrentlyOpen) {
                    closePanel(panelId);
                } else {
                    closeAllPanels(); 
                    openPanel(panelId);
                }
            });
        });

        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const panelId = e.currentTarget.getAttribute('data-panel');
                if (panelId) closePanel(panelId);
            });
        });

        document.querySelectorAll('.basemap-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const basemapId = e.currentTarget.getAttribute('data-basemap');
                changeBasemap(basemapId);
            });
        });

        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', debounce(performSearch, 300));
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') performSearch();
            });
        }

        const clearSearchBtn = document.getElementById('clear-search');
        if (clearSearchBtn) clearSearchBtn.addEventListener('click', clearSearch);

        document.querySelectorAll('#filter-panel input[type="checkbox"], #filter-panel select').forEach(input => {
            input.addEventListener('change', debounce(applyFilters, 300));
        });
        const applyFiltersBtn = document.getElementById('apply-filters');
        if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', applyFilters);
        const clearFiltersBtn = document.getElementById('clear-filters');
        if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);

        const plaquesToggle = document.getElementById('plaques-layer-toggle');
        if (plaquesToggle) plaquesToggle.addEventListener('change', toggleLayer);
        const propertiesToggle = document.getElementById('properties-layer-toggle');
        if (propertiesToggle) propertiesToggle.addEventListener('change', toggleLayer);

        const zoomExtentBtn = document.getElementById('zoom-extent-btn');
        if (zoomExtentBtn) zoomExtentBtn.addEventListener('click', zoomToAllFeatures);
        const fullscreenBtn = document.getElementById('fullscreen-btn');
        if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);

        const popupCloseBtn = document.querySelector('.popup-close');
        if (popupCloseBtn) popupCloseBtn.addEventListener('click', closeFeaturePopup);
        const zoomToFeatureBtn = document.getElementById('zoom-to-feature');
        if (zoomToFeatureBtn) zoomToFeatureBtn.addEventListener('click', zoomToCurrentFeature);
        const shareFeatureBtn = document.getElementById('share-feature');
        if (shareFeatureBtn) shareFeatureBtn.addEventListener('click', shareCurrentFeature);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllPanels();
                closeFeaturePopup();
            }
        });
    }

    function openPanel(panelId) {
        const panel = document.getElementById(panelId);
        const button = document.getElementById(panelId.replace('-panel', '-btn'));
        if (panel) {
            panel.classList.add('open');
            setTimeout(() => panel.classList.add('animate'), 10);
            if (button) button.classList.add('active');
        }
    }

    function closePanel(panelId) {
        const panel = document.getElementById(panelId);
        const button = document.getElementById(panelId.replace('-panel', '-btn'));
        if (panel) {
            panel.classList.remove('animate');
            setTimeout(() => panel.classList.remove('open'), 300);
             if (button) button.classList.remove('active');
        }
    }

    function closeAllPanels() {
        document.querySelectorAll('.search-panel.open, .layers-panel.open, .filter-panel.open, .info-panel.open').forEach(p => {
            closePanel(p.id);
        });
    }

    function changeBasemap(basemapId) {
        if (currentBasemap === basemapId || !map) return;
        currentBasemap = basemapId;
        map.basemap = basemapId;
        
        document.querySelectorAll('.basemap-option').forEach(option => {
            option.classList.remove('active');
        });
        const activeOption = document.querySelector(`.basemap-option[data-basemap="${basemapId}"]`);
        if (activeOption) {
            activeOption.classList.add('active');
            const basemapName = activeOption.querySelector('span') ? activeOption.querySelector('span').textContent.trim() : basemapId;
            showToast(window.getTranslatedString('mapApp.toast.basemapChanged', { basemapName: basemapName }), 'info');
        }
    }

    function performSearch() {
        const searchInput = document.getElementById('search-input');
        if (!searchInput) return;
        const query = searchInput.value.toLowerCase().trim();
        const resultsContainer = document.getElementById('search-results');
        if (!resultsContainer) return;
        
        if (!query) {
            resultsContainer.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <p>${window.getTranslatedString('mapApp.searchPanel.noResultsInfo')}</p>
                </div>`;
            searchResults = [];
            return;
        }

        searchResults = filteredFeatures.filter(featureItem => 
            featureItem.searchText.includes(query)
        );

        if (searchResults.length === 0) {
            resultsContainer.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>${window.getTranslatedString('mapApp.searchPanel.noResultsFound', { query: query })}</p>
                </div>`;
            return;
        }

        const resultsHTML = searchResults.map((resultItem, index) => `
            <div class="search-result" data-index="${index}">
                <div class="result-icon">
                    <i class="fas fa-${resultItem.type === 'plaque' ? 'circle' : 'square'}" style="color: ${resultItem.type === 'plaque' ? '#e74c3c' : '#3498db'}"></i>
                </div>
                <div class="result-content">
                    <h4>${resultItem.graphic.attributes.name}</h4>
                    <p>${resultItem.graphic.attributes.location || resultItem.graphic.attributes.city || 'Ontario'}</p>
                    <span class="result-type" style="background-color: ${resultItem.type === 'plaque' ? '#e74c3c' : '#3498db'}">${resultItem.graphic.attributes.type}</span>
                </div>
            </div>
        `).join('');

        resultsContainer.innerHTML = resultsHTML;

        document.querySelectorAll('.search-result').forEach(resultEl => {
            resultEl.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.getAttribute('data-index'));
                const selectedFeatureItem = searchResults[index];
                if (selectedFeatureItem) {
                    zoomToFeature(selectedFeatureItem.graphic);
                    showFeaturePopup(selectedFeatureItem.graphic);
                    closePanel('search-panel');
                }
            });
        });
    }

    function clearSearch() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';
        performSearch();
    }

    function populateFilters() {
        const regions = new Set();
        const cities = new Set();

        filteredFeatures.forEach(featureItem => {
            const city = featureItem.attributes.city;
            if (city) {
                cities.add(city);
                const region = extractRegion(city); 
                if (region) regions.add(region);
            }
        });

        const regionSelect = document.getElementById('region-filter');
        if (regionSelect) {
            while (regionSelect.options.length > 1) regionSelect.remove(1);
            Array.from(regions).sort().forEach(region => {
                const option = document.createElement('option');
                option.value = region;
                option.textContent = region;
                regionSelect.appendChild(option);
            });
        }


        const citySelect = document.getElementById('city-filter');
        if (citySelect) {
            while (citySelect.options.length > 1) citySelect.remove(1);
            Array.from(cities).sort().forEach(city => {
                const option = document.createElement('option');
                option.value = city;
                option.textContent = city;
                citySelect.appendChild(option);
            });
        }
    }

    function extractRegion(city) {
        if (!city) return 'Other';
        const cityLower = city.toLowerCase();
        if (cityLower.includes('toronto') || cityLower.includes('mississauga') || cityLower.includes('brampton') || cityLower.includes('markham') || cityLower.includes('vaughan')) return 'Greater Toronto Area';
        if (cityLower.includes('ottawa') || cityLower.includes('kingston')) return 'Eastern Ontario';
        if (cityLower.includes('london') || cityLower.includes('windsor') || cityLower.includes('kitchener') || cityLower.includes('waterloo')|| cityLower.includes('hamilton')) return 'Southwestern Ontario';
        if (cityLower.includes('sudbury') || cityLower.includes('thunder bay') || cityLower.includes('sault ste. marie')) return 'Northern Ontario';
        return 'Other';
    }

    function applyFilters() {
        const typeFilters = Array.from(document.querySelectorAll('#filter-panel .filter-group input[type="checkbox"]:checked'))
            .map(cb => cb.value);
        const regionFilterEl = document.getElementById('region-filter');
        const regionFilter = regionFilterEl ? regionFilterEl.value : "";
        const cityFilterEl = document.getElementById('city-filter');
        const cityFilter = cityFilterEl ? cityFilterEl.value : "";

        if (plaquesLayer) plaquesLayer.removeAll();
        if (propertiesLayer) propertiesLayer.removeAll();

        let plaquesShown = 0;
        let propertiesShown = 0;

        filteredFeatures.forEach(featureItem => {
            let show = true;
            const attributes = featureItem.attributes;

            if (typeFilters.length > 0 && !typeFilters.includes(featureItem.type)) {
                show = false;
            }
            if (show && regionFilter && extractRegion(attributes.city) !== regionFilter) {
                show = false;
            }
            if (show && cityFilter && attributes.city !== cityFilter) {
                show = false;
            }

            if (show) {
                const targetLayer = featureItem.type === 'plaque' ? plaquesLayer : propertiesLayer;
                if (targetLayer) targetLayer.add(featureItem.graphic);
                if (featureItem.type === 'plaque') plaquesShown++;
                else propertiesShown++;
            }
        });
        
        const plaquesCountEl = document.getElementById('plaques-layer-count');
        if (plaquesCountEl) plaquesCountEl.textContent = `(${plaquesShown})`;
        const propertiesCountEl = document.getElementById('properties-layer-count');
        if (propertiesCountEl) propertiesCountEl.textContent = `(${propertiesShown})`;
        
        updateVisibleSitesCount();
        showToast(window.getTranslatedString('mapApp.toast.filtersApplied'), 'info');
    }

    function clearFilters() {
        document.querySelectorAll('#filter-panel input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
        });
        const regionFilter = document.getElementById('region-filter');
        if (regionFilter) regionFilter.value = '';
        const cityFilter = document.getElementById('city-filter');
        if (cityFilter) cityFilter.value = '';
        applyFilters();
        showToast(window.getTranslatedString('mapApp.toast.filtersCleared'), 'info');
    }

    function toggleLayer(e) {
        const layerId = e.target.id.includes('plaques') ? 'plaques' : 'properties';
        const layer = layerId === 'plaques' ? plaquesLayer : propertiesLayer;
        
        if (layer) layer.visible = e.target.checked;
        
        updateDynamicLayerCounts();
        updateVisibleSitesCount();
    }

    function zoomToAllFeatures() {
        if (!view) return;
        const allVisibleGraphics = [];
        if (plaquesLayer && plaquesLayer.visible) allVisibleGraphics.push(...plaquesLayer.graphics.items);
        if (propertiesLayer && propertiesLayer.visible) allVisibleGraphics.push(...propertiesLayer.graphics.items);

        if (allVisibleGraphics.length === 0) {
             view.goTo({ center: [-85, 49], zoom: 6 }, { duration: 1500, easing: "ease-in-out" });
            return;
        }

        const geometries = allVisibleGraphics.map(graphic => graphic.geometry);
        try {
            const fullExtent = geometryEngine.union(geometries).extent;
            if (fullExtent) {
                 view.goTo(fullExtent.expand(1.3), {
                    duration: 1500,
                    easing: "ease-in-out"
                });
            } else if (allVisibleGraphics.length === 1) {
                zoomToFeature(allVisibleGraphics[0]);
            }
        } catch (error) {
            console.error("Error calculating extent for zoomToAllFeatures:", error, geometries);
             view.goTo({ center: [-85, 49], zoom: 6 });
        }
    }

    function zoomToFeature(graphic) {
        if (!graphic || !graphic.geometry || !view) return;
        const geometry = graphic.geometry;
        let target;

        if (geometry.type === 'point') {
            target = { target: geometry, zoom: 16 };
        } else if (geometry.extent) {
            target = geometry.extent.clone().expand(1.5);
        } else {
            return;
        }

        view.goTo(target, {
            duration: 1500,
            easing: "ease-in-out"
        }).catch(error => console.warn("Zoom to feature error:", error));
    }

    function showFeaturePopup(graphic) {
        const popup = document.getElementById('feature-popup');
        if (!popup) return;
        const titleEl = document.getElementById('popup-title');
        const contentEl = document.getElementById('popup-content');

        if (titleEl) titleEl.textContent = graphic.attributes.name;
        if (!contentEl) return;
        
        let detailedDescription = "";
        const rawDescription = graphic.attributes.description;

        if (rawDescription) {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(rawDescription, 'text/html');
                const mainContentTable = doc.querySelector('body > table > tr:nth-child(2) > td > table');
                if (mainContentTable) {
                    let tempDesc = "";
                    const rows = mainContentTable.querySelectorAll('tr');
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length === 2) {
                            const key = cells[0].textContent.trim();
                            const value = cells[1].textContent.trim();
                            if (!['title', 'property name', 'location', 'city', 'community', 'municipality (lower tier)', 'type of site'].includes(key.toLowerCase())) {
                                if (value) tempDesc += `<p><strong>${key}:</strong> ${value}</p>`;
                            }
                        } else if (cells.length === 1 && cells[0].colSpan === 2) {
                            if (cells[0].textContent.trim()) tempDesc += `<div class="popup-full-description-text">${cells[0].innerHTML}</div>`;
                        }
                    });
                    detailedDescription = tempDesc || `<p>${window.getTranslatedString('mapApp.featurePopup.noDetailsExtracted')}</p>`;
                } else {
                    let bodyText = doc.body.innerText || doc.body.textContent || "";
                    bodyText = bodyText.replace(graphic.attributes.name, "").trim();
                    if (bodyText.length > 20 && bodyText.length < 2000) {
                         detailedDescription = `<p>${bodyText.split('\n').filter(s => s.trim()).join('</p><p>')}</p>`;
                    } else {
                        detailedDescription = `<p>${window.getTranslatedString('mapApp.featurePopup.viewOnOHT')}</p>`;
                    }
                }
            } catch(e) { 
                console.warn("Error parsing feature description for popup:", e);
                detailedDescription = `<p>${window.getTranslatedString('mapApp.featurePopup.parseError')}</p>`; 
            }
        } else {
            detailedDescription = `<p>${window.getTranslatedString('mapApp.featurePopup.noDescription')}</p>`;
        }

        contentEl.innerHTML = `
            <div class="popup-detail">
                ${graphic.attributes.location ? `<div class="popup-field">
                    <span class="field-label">${window.getTranslatedString('mapApp.featurePopup.detailsLocation')}</span>
                    <span class="field-value">${graphic.attributes.location}</span>
                </div>` : ''}
                ${graphic.attributes.city ? `<div class="popup-field">
                    <span class="field-label">${window.getTranslatedString('mapApp.featurePopup.detailsMunicipality')}</span>
                    <span class="field-value">${graphic.attributes.city}</span>
                </div>` : ''}
                <div class="popup-field">
                    <span class="field-label">${window.getTranslatedString('mapApp.featurePopup.detailsType')}</span>
                    <span class="field-value">${graphic.attributes.type}</span>
                </div>
                <hr style="margin: 10px 0;">
                <h4>${window.getTranslatedString('mapApp.featurePopup.additionalDetails')}</h4>
                <div class="popup-description-scrollable">${detailedDescription}</div>
                <a href="https://www.heritagetrust.on.ca/search-results?sf_search=${encodeURIComponent(graphic.attributes.name)}" target="_blank" class="popup-btn more-info-link">
                    <i class="fas fa-external-link-alt"></i> ${window.getTranslatedString('mapApp.featurePopup.moreInfoLink')}
                </a>
            </div>
        `;

        popup.classList.add('show');
        popup.currentFeature = graphic;

        highlightFeature(graphic);
    }

    function closeFeaturePopup() {
        const popup = document.getElementById('feature-popup');
        if (popup) {
            popup.classList.remove('show');
            popup.currentFeature = null;
        }
        removeHighlight();
    }

    let highlightHandle = null;
    function highlightFeature(graphic) {
        removeHighlight();

        if (!graphic || !view || !graphic.layer) return;

        view.whenLayerView(graphic.layer).then(layerView => {
            if (layerView) highlightHandle = layerView.highlight(graphic);
        }).catch(error => console.warn("Highlight error:", error));
    }

    function removeHighlight() {
        if (highlightHandle) {
            highlightHandle.remove();
            highlightHandle = null;
        }
    }

    function zoomToCurrentFeature() {
        const popup = document.getElementById('feature-popup');
        if (popup && popup.currentFeature) {
            zoomToFeature(popup.currentFeature);
        }
    }

    function shareCurrentFeature() {
        const popup = document.getElementById('feature-popup');
        if (popup && popup.currentFeature) {
            const feature = popup.currentFeature;
            const featureNameEncoded = encodeURIComponent(feature.attributes.name);
            const url = `${window.location.origin}${window.location.pathname}?feature=${featureNameEncoded}`;
            
            if (navigator.share) {
                navigator.share({
                    title: `Ontario Heritage: ${feature.attributes.name}`,
                    text: `Check out this heritage site: ${feature.attributes.name}`,
                    url: url
                }).catch(err => console.warn("Share API error:", err));
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(url).then(() => {
                    showToast(window.getTranslatedString('mapApp.toast.linkFeatureCopied'), 'success');
                }).catch(err => {
                    showToast(window.getTranslatedString('mapApp.toast.linkCopyError'), 'error');
                    console.error('Clipboard API error:', err);
                });
            } else {
                 showToast(window.getTranslatedString('mapApp.toast.sharingNotSupported'), 'info');
            }
        }
    }

    function shareMapView() {
        if (!view || !view.center) {
            showToast(window.getTranslatedString('mapApp.toast.mapViewNotReady'), 'warn');
            return;
        }
        const center = view.center;
        const zoom = view.zoom;
        const url = `${window.location.origin}${window.location.pathname}?lat=${center.latitude.toFixed(5)}&lon=${center.longitude.toFixed(5)}&zoom=${Math.round(zoom)}`;
        
        if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => {
                showToast(window.getTranslatedString('mapApp.toast.linkCopied'), 'success');
            }).catch(err => {
                showToast(window.getTranslatedString('mapApp.toast.linkCopyError'), 'error');
                console.error('Error copying map view link:', err);
            });
        } else {
            showToast(window.getTranslatedString('mapApp.toast.sharingNotSupported'), 'info');
        }
    }

    function toggleFullscreen() {
        const btn = document.getElementById('fullscreen-btn');
        if (!btn) return;
        const icon = btn.querySelector('i');
        
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => {
                if (icon) icon.className = 'fas fa-compress';
                btn.title = window.getTranslatedString('mapApp.mapControls.exitFullscreen');
            }).catch(err => console.warn("Fullscreen request failed:", err));
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().then(() => {
                    if (icon) icon.className = 'fas fa-expand';
                    btn.title = window.getTranslatedString('mapApp.mapControls.fullscreen');
                }).catch(err => console.warn("Exit fullscreen failed:", err));
            }
        }
    }
    document.addEventListener('fullscreenchange', () => {
        const btn = document.getElementById('fullscreen-btn');
        if (!btn) return;
        const icon = btn.querySelector('i');
        if (!document.fullscreenElement) {
            if (icon) icon.className = 'fas fa-expand';
            btn.title = window.getTranslatedString('mapApp.mapControls.fullscreen');
        } else {
            if (icon) icon.className = 'fas fa-compress';
            btn.title = window.getTranslatedString('mapApp.mapControls.exitFullscreen');
        }
    });

    function updateStatistics() {
        if (!plaquesLayer || !propertiesLayer) return;
        const masterPlaquesCount = filteredFeatures.filter(f => f.type === 'plaque').length;
        const masterPropertiesCount = filteredFeatures.filter(f => f.type === 'property').length;

        const totalSitesEl = document.getElementById('total-sites');
        if (totalSitesEl) totalSitesEl.textContent = masterPlaquesCount + masterPropertiesCount;
        const totalPlaquesEl = document.getElementById('total-plaques');
        if (totalPlaquesEl) totalPlaquesEl.textContent = masterPlaquesCount;
        const totalPropertiesEl = document.getElementById('total-properties');
        if (totalPropertiesEl) totalPropertiesEl.textContent = masterPropertiesCount;
    }

    function updateVisibleSitesCount() {
        if (!view || !view.extent || isLoading) return;
        
        let visibleCount = 0;
        const currentExtent = view.extent;

        if (plaquesLayer && plaquesLayer.visible) {
            plaquesLayer.graphics.forEach(graphic => {
                if (graphic.geometry && currentExtent.intersects(graphic.geometry)) {
                    visibleCount++;
                }
            });
        }
        if (propertiesLayer && propertiesLayer.visible) {
            propertiesLayer.graphics.forEach(graphic => {
                 if (graphic.geometry && currentExtent.intersects(graphic.geometry)) {
                    visibleCount++;
                }
            });
        }
        const visibleSitesEl = document.getElementById('visible-sites');
        if (visibleSitesEl) visibleSitesEl.textContent = visibleCount;
    }

    function updateDynamicLayerCounts() {
        if (!view || !view.extent || isLoading) return;

        let visiblePlaques = 0;
        const currentExtent = view.extent;

        if (plaquesLayer && plaquesLayer.visible) {
            plaquesLayer.graphics.forEach(graphic => {
                if (graphic.geometry && currentExtent.intersects(graphic.geometry)) {
                    visiblePlaques++;
                }
            });
        }
        const plaquesLayerCountEl = document.getElementById('plaques-layer-count');
        if (plaquesLayerCountEl) plaquesLayerCountEl.textContent = `(${visiblePlaques})`;

        let visibleProperties = 0;
        if (propertiesLayer && propertiesLayer.visible) {
            propertiesLayer.graphics.forEach(graphic => {
                if (graphic.geometry && currentExtent.intersects(graphic.geometry)) {
                    visibleProperties++;
                }
            });
        }
        const propertiesLayerCountEl = document.getElementById('properties-layer-count');
        if (propertiesLayerCountEl) propertiesLayerCountEl.textContent = `(${visibleProperties})`;
    }

    function showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const iconClass = type === 'success' ? 'fa-check-circle' : 
                         type === 'error' ? 'fa-exclamation-triangle' : 
                         type === 'warn' ? 'fa-exclamation-circle' :
                         'fa-info-circle';
        
        toast.innerHTML = `<i class="fas ${iconClass}"></i><span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 100);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode === container) {
                    container.removeChild(toast);
                }
            }, 300);
        }, duration);
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function handleUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const featureName = urlParams.get('feature');
        const viewLat = urlParams.get('lat');
        const viewLon = urlParams.get('lon');
        const viewZoom = urlParams.get('zoom');
        let actedOnParams = false;

        if (featureName) {
            const featureToSelect = filteredFeatures.find(f => f.graphic.attributes.name === decodeURIComponent(featureName));
            if (featureToSelect) {
                zoomToFeature(featureToSelect.graphic);
                showFeaturePopup(featureToSelect.graphic);
                actedOnParams = true;
            } else {
                showToast(window.getTranslatedString('mapApp.toast.featureNotFound', { featureName: decodeURIComponent(featureName) }), 'warn');
            }
        } else if (viewLat && viewLon && viewZoom) {
            const lat = parseFloat(viewLat);
            const lon = parseFloat(viewLon);
            const zoom = parseInt(viewZoom);
            if (!isNaN(lat) && !isNaN(lon) && !isNaN(zoom)) {
                 view.goTo({ center: [lon, lat], zoom: zoom })
                     .catch(err => console.warn("GoTo from URL params failed:", err));
                 actedOnParams = true;
            }
        }
        return actedOnParams;
    }

    window.updateMapUIText = function() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.placeholder = window.getTranslatedString('mapApp.searchPanel.placeholder');

        document.querySelectorAll('.basemap-option').forEach(option => {
            const basemapId = option.getAttribute('data-basemap');
            let keySuffix = '';
            switch(basemapId) {
                case 'streets-vector': keySuffix = 'Streets'; break;
                case 'satellite': keySuffix = 'Satellite'; break;
                case 'hybrid': keySuffix = 'Hybrid'; break;
                case 'topo-vector': keySuffix = 'Topo'; break;
                case 'gray-vector': keySuffix = 'LightGray'; break;
                case 'dark-gray-vector': keySuffix = 'DarkGray'; break;
            }
            if (keySuffix) {
                const span = option.querySelector('span');
                if (span) span.textContent = window.getTranslatedString(`mapApp.layersPanel.basemap${keySuffix}`);
            }
        });
        
        const regionFilter = document.getElementById('region-filter');
        if(regionFilter && regionFilter.options[0]) regionFilter.options[0].textContent = window.getTranslatedString('mapApp.filterPanel.allRegions');
        const cityFilter = document.getElementById('city-filter');
        if(cityFilter && cityFilter.options[0]) cityFilter.options[0].textContent = window.getTranslatedString('mapApp.filterPanel.allCities');

        if (typeof performSearch === 'function' && document.getElementById('search-input')?.value) performSearch();
        const currentPopup = document.getElementById('feature-popup');
        if (currentPopup && currentPopup.classList.contains('show') && currentPopup.currentFeature) {
            const feature = currentPopup.currentFeature;
            let originalTypeKey = 'property'; 
            if (feature.attributes.originalData && typeof feature.attributes.originalData.dataSourceKey === 'string') {
                 if (feature.attributes.originalData.dataSourceKey.toLowerCase().includes('plaque')) {
                    originalTypeKey = 'plaque';
                 }
            } else if (feature.type === window.getTranslatedString('mapApp.filterPanel.plaques', 'en') || feature.type === window.getTranslatedString('mapApp.filterPanel.plaques', 'fr')) {
                 originalTypeKey = 'plaque';
            }

            feature.attributes.type = originalTypeKey === 'plaque'
                ? window.getTranslatedString('mapApp.filterPanel.plaques')
                : window.getTranslatedString('mapApp.filterPanel.properties');
            showFeaturePopup(feature);
        }
    };
});