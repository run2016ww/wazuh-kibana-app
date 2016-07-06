// Require utils
var kuf = require('plugins/wazuh/utils/kibanaUrlFormatter.js');
// Require config
var app = require('ui/modules').get('app/wazuh', []);

app.controller('kibanaIntegrationController', function ($scope, sharedProperties) {

    //Print Error
    var printError = function (error) {
        alertify.delay(10000).closeLogOnClick(true).error(error.html);
    }

    $scope.getDashboard = function (dashboard, filter, time, url) {
        if (!filter) {
            filter = '';
        }
        if (!time) {
            time = '';
        }
        if (url == undefined) {
            url = false;
        }
        return kuf.getDashboard(dashboard, filter, time, url);
    };

    $scope.getAlerts = function (index, filter, time, url) {
        if (!filter) {
            filter = '';
        }
        if (!time) {
            time = '';
        }
        if (url == undefined) {
            url = false;
        }
        return kuf.getAlerts(index, filter, time, url);
    };

    $scope.getVisualization = function (visName, filter, time, url) {
        if (!filter) {
            filter = '';
        }
        if (!time) {
            time = '';
        }
        if (url == undefined) {
            url = false;
        }
        return kuf.getVisualization(visName, filter, time, url);
    };

    //Load
    var initialize = sharedProperties.getProperty();
        if ((initialize != '') && (initialize.substring(0, 4) == 'aa//')) {
            $scope.defAlertFilter = initialize.substring(4);
            sharedProperties.setProperty('');
        } else {
            $scope.defAlertFilter = '';
        }
        if ((initialize != '') && (initialize.substring(0, 4) == 'ad//')) {
            $scope.defDashboardFilter = initialize.substring(4);
            sharedProperties.setProperty('');
        } else {
            $scope.defDashboardFilter = '';
        }

});