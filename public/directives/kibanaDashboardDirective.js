import _ from 'lodash';
import $ from 'jquery';
import chrome from 'ui/chrome';
import rison from 'rison-node';
import 'ui/courier';
import 'ui/config';
import 'ui/notify';
import 'ui/typeahead';
import 'ui/share';
import 'plugins/kibana/dashboard/components/panel/panel.html';
import 'plugins/kibana/dashboard/services/saved_dashboards';
import 'plugins/kibana/dashboard/styles/main.less';
import FilterBarQueryFilterProvider from 'ui/filter_bar/query_filter';
import DocTitleProvider from 'ui/doc_title';
import uiRoutes from 'ui/routes';
import uiModules from 'ui/modules';
import indexTemplate from 'plugins/wazuh/templates/directives/dash-template.html';
import 'ui/directives/saved_object_finder.js';


require('plugins/kibana/management/saved_object_registry').register({
  service: 'savedDashboards',
  title: 'dashboards'
});

require('ui/saved_objects/saved_object_registry').register(require('plugins/kibana/dashboard/services/saved_dashboard_register'));

const app = uiModules.get('app/wazuh', [
    'elasticsearch',
    'ngRoute',
    'kibana/courier',
    'kibana/config',
    'kibana/notify',
    'kibana/typeahead',
    'app/dashboard'
]);

app.directive('kbnDash', function (Notifier, courier, AppState, timefilter, kbnUrl) {
    return {
        scope: {
        dashId: '@dashId',
        dashFilter: '@dashFilter',
        dashTimeFrom: '@dashTimeFrom',
        dashTimeTo: '@dashTimeTo',
        dashSearchable: '@dashSearchable',
        dashTimepicker: '@dashTimepicker'
      },
        controller: function ($scope, $rootScope, $route, $routeParams, $location, Private, getAppState, savedDashboards, appState, genericReq, SavedVis) {
            $scope.chrome = {};
            $scope.chrome.getVisible = function () {return true};
			
            $scope.topNavMenu = [{
                key: 'open',
                description: 'Load Saved Dashboard',
                template: require('plugins/kibana/dashboard/partials/load_dashboard.html')
            }];
			
	
            $route.requireDefaultIndex = true;
			savedDashboards.get($scope.dashId).then(function (_dash) {
				$scope.dash = _dash;
				const dash = _dash;

				const queryFilter = Private(FilterBarQueryFilterProvider);

				const notify = new Notifier({
					location: '*'
				});

				if (dash.timeRestore && dash.timeTo && dash.timeFrom && !getAppState.previouslyStored()) {
					timefilter.time.to = dash.timeTo;
					timefilter.time.from = dash.timeFrom;
					if (dash.refreshInterval) {
						timefilter.refreshInterval = dash.refreshInterval;
					}
				}

				if ($scope.dashTimeTo && $scope.dashTimeFrom) {
					timefilter.time.to = $scope.dashTimeTo;
					timefilter.time.from = $scope.dashTimeFrom;
				}

				$scope.$on('$destroy', dash.destroy);

				const matchQueryFilter = function (filter) {
					return filter.query && filter.query.query_string && !filter.meta;
				};

				const extractQueryFromFilters = function (filters) {
					const filter = _.find(filters, matchQueryFilter);
					if (filter) return filter.query;
				};

		  
				const stateDefaults = {
					title: dash.title,
					panels: dash.panelsJSON ? JSON.parse(dash.panelsJSON) : [],
					options: dash.optionsJSON ? JSON.parse(dash.optionsJSON) : {},
					uiState: dash.uiStateJSON ? JSON.parse(dash.uiStateJSON) : {},
					query: extractQueryFromFilters(dash.searchSource.getOwn('filter')) || { query_string: { query: '*' } },
					filters: _.reject(dash.searchSource.getOwn('filter'), matchQueryFilter)
				};

				// Configure AppState. Get App State, if there is no App State create new one
				let currentAppState = getAppState();

				if(!currentAppState)
					$scope.state = new AppState(stateDefaults);
				else{
					$scope.state = currentAppState;
					$scope.state.title = dash.title;
					$scope.state.panels = dash.panelsJSON ? JSON.parse(dash.panelsJSON) : [];
					$scope.state.options = dash.optionsJSON ? JSON.parse(dash.optionsJSON) : {};
					$scope.state.uiState = dash.uiStateJSON ? JSON.parse(dash.uiStateJSON) : {};
					$scope.state.query = extractQueryFromFilters(dash.searchSource.getOwn('filter')) || { query_string: { query: '*' } };					
				}

				const $state = $scope.state;
				
				const $uiState = $scope.uiState = $state.makeStateful('uiState');

				$scope.$watchCollection('state.options', function (newVal, oldVal) {
					if (!angular.equals(newVal, oldVal)) $state.save();
				});
				$scope.$watch('state.options.darkTheme', setDarkTheme);

				$scope.refresh = _.bindKey(courier, 'fetch');

				timefilter.enabled = true;
				$scope.timefilter = timefilter;
				$scope.$listen(timefilter, 'fetch', $scope.refresh);

				courier.setRootSearchSource(dash.searchSource);

				function init() {
					updateQueryOnRootSource();

					const docTitle = Private(DocTitleProvider);
					if (dash.id) {
						docTitle.change(dash.title);
					}

					initPanelIndices();
					$scope.$emit('application.load');
				}

				function initPanelIndices() {
					// find the largest panelIndex in all the panels
					let maxIndex = getMaxPanelIndex();
					// ensure that all panels have a panelIndex
					$scope.state.panels.forEach(function (panel) {
						if (!panel.panelIndex) {
							panel.panelIndex = maxIndex++;
						}
					});
				}

				function getMaxPanelIndex() {
					
					let index = $scope.state.panels.reduce(function (idx, panel) {
						// if panel is missing an index, add one and increment the index
						return Math.max(idx, panel.panelIndex || idx);
					}, 0);
					return ++index;
				}

				$scope.$watch("dashFilter", function () {
					$state.query = { query_string: { query: $scope.dashFilter ? $scope.dashFilter : '*' } };
					$scope.filterResults();
				});

				function updateQueryOnRootSource() {
					const filters = queryFilter.getFilters();
					if ($state.query) {
						dash.searchSource.set('filter', _.union(filters, [{
							query: $state.query
						}]));
					} else {
						dash.searchSource.set('filter', filters);
					}
				}

				function setDarkTheme(enabled) {
					const theme = Boolean(enabled) ? 'theme-dark' : 'theme-light';
					chrome.removeApplicationClass(['theme-dark', 'theme-light']);
					chrome.addApplicationClass(theme);
				}

				// update root source when filters update
				$scope.$listen(queryFilter, 'update', function () {
					updateQueryOnRootSource();
					$state.save();
				});

				// update data when filters fire fetch event
				$scope.$listen(queryFilter, 'fetch', $scope.refresh);

				$scope.newDashboard = function () {
					kbnUrl.change('/dashboard', {});
				};

				$scope.filterResults = function () {
					updateQueryOnRootSource();
					$state.save();
					$scope.refresh();
				};

				$scope.save = function () {
					$state.title = dash.id = dash.title;
					$state.save();

					const timeRestoreObj = _.pick(timefilter.refreshInterval, ['display', 'pause', 'section', 'value']);
					dash.panelsJSON = angular.toJson($state.panels);
					dash.uiStateJSON = angular.toJson($uiState.getChanges());
					dash.timeFrom = dash.timeRestore ? timefilter.time.from : undefined;
					dash.timeTo = dash.timeRestore ? timefilter.time.to : undefined;
					dash.refreshInterval = dash.timeRestore ? timeRestoreObj : undefined;
					dash.optionsJSON = angular.toJson($state.options);

					dash.save()
						.then(function (id) {
							$scope.kbnTopNav.close('save');
							if (id) {
								if (dash.id !== $routeParams.id) {
									kbnUrl.change('/dashboard/{{id}}', { id: dash.id });
								}
							}
						})
						.catch();
				};

				let pendingVis = _.size($state.panels);
				$scope.$on('ready:vis', function () {
					if (pendingVis) pendingVis--;
					if (pendingVis === 0) {
						$state.save();
						$scope.refresh();
					}
				});

				// listen for notifications from the grid component that changes have
				// been made, rather than watching the panels deeply
				$scope.$on('change:vis', function () {
					$state.save();
				});

				// called by the saved-object-finder when a user clicks a vis
				$scope.addVis = function (hit) {
					pendingVis++;
					$state.panels.push({ id: hit.id, type: 'visualization', panelIndex: getMaxPanelIndex() });
				};

				$scope.addSearch = function (hit) {
					pendingVis++;
					$state.panels.push({ id: hit.id, type: 'search', panelIndex: getMaxPanelIndex() });
				};

				// Setup configurable values for config directive, after objects are initialized
				$scope.opts = {
					dashboard: dash,
					ui: $state.options,
					save: $scope.save,
					addVis: $scope.addVis,
					addSearch: $scope.addSearch,
					timefilter: $scope.timefilter
				};

				init();
			}).catch(console.log('Dashboard not found!'));
        },
        template: indexTemplate
    }
});


import Binder from 'ui/binder';
import 'gridster';

app.directive('dashboardGrid', function ($compile, Notifier) {
  return {
    restrict: 'E',
    require: '^kbnDash', // must inherit from the dashboardApp
    link: function ($scope, $el) {
      const notify = new Notifier();
      const $container = $el;
      $el = $('<ul>').appendTo($container);

      const $window = $(window);
      const $body = $(document.body);
      const binder = new Binder($scope);

      // appState from controller
      const $state = $scope.state;

      let gridster; // defined in init()

      // number of columns to render
      const COLS = 12;
      // number of pixed between each column/row
      const SPACER = 0;
      // pixels used by all of the spacers (gridster puts have a spacer on the ends)
      const spacerSize = SPACER * COLS;

      // debounced layout function is safe to call as much as possible
      const safeLayout = _.debounce(layout, 200);

      function init() {
        $el.addClass('gridster');

        gridster = $el.gridster({
          max_cols: COLS,
          min_cols: COLS,
          autogenerate_stylesheet: false,
          resize: {
            enabled: true,
            stop: readGridsterChangeHandler
          },
          draggable: {
            handle: '.panel-move, .fa-arrows',
            stop: readGridsterChangeHandler
          }
        }).data('gridster');

        // This is necessary to enable text selection within gridster elements
        // http://stackoverflow.com/questions/21561027/text-not-selectable-from-editable-div-which-is-draggable
        binder.jqOn($el, 'mousedown', function () {
          gridster.disable().disable_resize();
        });
        binder.jqOn($el, 'mouseup', function enableResize() {
          gridster.enable().enable_resize();
        });

        $scope.$watchCollection('state.panels', function (panels) {
          const currentPanels = gridster.$widgets.toArray().map(function (el) {
            return getPanelFor(el);
          });

          // panels that are now missing from the panels array
          const removed = _.difference(currentPanels, panels);

          // panels that have been added
          const added = _.difference(panels, currentPanels);

          if (removed.length) removed.forEach(removePanel);
          if (added.length) added.forEach(addPanel);

          // ensure that every panel can be serialized now that we are done
          $state.panels.forEach(makePanelSerializeable);

          // alert interested parties that we have finished processing changes to the panels
          // TODO: change this from event based to calling a method on dashboardApp
          if (added.length || removed.length) $scope.$root.$broadcast('change:vis');
        });

        $scope.$on('$destroy', function () {
          safeLayout.cancel();
          $window.off('resize', safeLayout);

          if (!gridster) return;
          gridster.$widgets.each(function (i, el) {
            const panel = getPanelFor(el);
            // stop any animations
            panel.$el.stop();
            removePanel(panel, true);
            // not that we will, but lets be safe
            makePanelSerializeable(panel);
          });
        });

        safeLayout();
        $window.on('resize', safeLayout);
        $scope.$on('ready:vis', safeLayout);
        $scope.$on('globalNav:update', safeLayout);
      }

      // return the panel object for an element.
      //
      // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      // ALWAYS CALL makePanelSerializeable AFTER YOU ARE DONE WITH IT
      // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      function getPanelFor(el) {
        const $panel = el.jquery ? el : $(el);
        const panel = $panel.data('panel');

        panel.$el = $panel;
        panel.$scope = $panel.data('$scope');

        return panel;
      }

      // since the $el and $scope are circular structures, they need to be
      // removed from panel before it can be serialized (we also wouldn't
      // want them to show up in the url)
      function makePanelSerializeable(panel) {
        delete panel.$el;
        delete panel.$scope;
      }

      // tell gridster to remove the panel, and cleanup our metadata
      function removePanel(panel, silent) {
        // remove from grister 'silently' (don't reorganize after)
        gridster.remove_widget(panel.$el, silent);

        // destroy the scope
        panel.$scope.$destroy();

        panel.$el.removeData('panel');
        panel.$el.removeData('$scope');
      }

      // tell gridster to add the panel, and create additional meatadata like $scope
      function addPanel(panel) {
        _.defaults(panel, {
          size_x: 3,
          size_y: 2
        });

        // ignore panels that don't have vis id's
        if (!panel.id) {
          // In the interest of backwards compat
          if (panel.visId) {
            panel.id = panel.visId;
            panel.type = 'visualization';
            delete panel.visId;
          } else {
            throw new Error('missing object id on panel');
          }
        }

        panel.$scope = $scope.$new();
        panel.$scope.panel = panel;
        panel.$scope.parentUiState = $scope.uiState;

        panel.$el = $compile('<li><dashboard-panel></li>')(panel.$scope);

        // tell gridster to use the widget
        gridster.add_widget(panel.$el, panel.size_x, panel.size_y, panel.col, panel.row);

        // update size/col/etc.
        refreshPanelStats(panel);

        // stash the panel and it's scope in the element's data
        panel.$el.data('panel', panel);
        panel.$el.data('$scope', panel.$scope);
      }

      // ensure that the panel object has the latest size/pos info
      function refreshPanelStats(panel) {
        const data = panel.$el.coords().grid;
        panel.size_x = data.size_x;
        panel.size_y = data.size_y;
        panel.col = data.col;
        panel.row = data.row;
      }

      // when gridster tell us it made a change, update each of the panel objects
      function readGridsterChangeHandler(e, ui, $widget) {
        // ensure that our panel objects keep their size in sync
        gridster.$widgets.each(function (i, el) {
          const panel = getPanelFor(el);
          refreshPanelStats(panel);
          panel.$scope.$broadcast('resize');
          makePanelSerializeable(panel);
          $scope.$root.$broadcast('change:vis');
        });
      }

      // calculate the position and sizing of the gridster el, and the columns within it
      // then tell gridster to "reflow" -- which is definitely not supported.
      // we may need to consider using a different library
      function reflowGridster() {
        // https://github.com/gcphost/gridster-responsive/blob/97fe43d4b312b409696b1d702e1afb6fbd3bba71/jquery.gridster.js#L1208-L1235
        const g = gridster;

        g.options.widget_margins = [SPACER / 2, SPACER / 2];
        g.options.widget_base_dimensions = [($container.width() - spacerSize) / COLS, 100];
        g.min_widget_width  = (g.options.widget_margins[0] * 2) + g.options.widget_base_dimensions[0];
        g.min_widget_height = (g.options.widget_margins[1] * 2) + g.options.widget_base_dimensions[1];

        // const serializedGrid = g.serialize();
        g.$widgets.each(function (i, widget) {
          g.resize_widget($(widget));
        });

        g.generate_grid_and_stylesheet();
        g.generate_stylesheet({ namespace: '.gridster' });

        g.get_widgets_from_DOM();
        // We can't call this method if the gridmap is empty. This was found
        // when the user double clicked the "New Dashboard" icon. See
        // https://github.com/elastic/kibana4/issues/390
        if (gridster.gridmap.length > 0) g.set_dom_grid_height();
        g.drag_api.set_limits(COLS * g.min_widget_width);
      }

      function layout() {
        const complete = notify.event('reflow dashboard');
        reflowGridster();
        readGridsterChangeHandler();
        complete();
      }

      init();
    }
  };
});