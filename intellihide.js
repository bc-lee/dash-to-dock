// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const _DEBUG_ = false;

const Lang = imports.lang;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;

const handledWindowTypes = [
  Meta.WindowType.NORMAL,
  // Meta.WindowType.DESKTOP,    // skip nautilus dekstop window
  // Meta.WindowType.DOCK,       // skip other docks
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
  Meta.WindowType.TOOLBAR,
  Meta.WindowType.MENU,
  Meta.WindowType.UTILITY,
  Meta.WindowType.SPLASHSCREEN,
]

const IntellihideMode = {
    HIDE: 0,            // Dash is always invisible
    SHOW: 1,            // Dash is always visible
    AUTOHIDE:2,         // Basic autohide mode: visible on mouse hover
    INTELLIHIDE: 3      // Basic intellihide mode: visible if no window overlap the dash
};

// Settings (ALl almost unusable...):
//
// Current limitations:
//  1. IntellihideMode.HIDE does not exist.
//  2. Using intellihideMode.AUTOHIDE  in OVERVIEW_MODE is not a good idea: you cannot
//     anymore drag and drop icons on windows on the dash as it is hidden. Moreover you 
//     get nothing in return. No space is saved currently like in hideDash extension. Use
//     this mode only if you really hate to see the dash there!
//  3. Also intellihideMode.INTELLIHIDE  in OVERVIEW_MODE doesn't make sense...
const NORMAL_MODE = IntellihideMode.INTELLIHIDE;
const OVERVIEW_MODE = IntellihideMode.SHOW;


/*
 * A rough and ugly implementation of the intellihide behaviour.
 * Intallihide object: call show()/hide() function based on the overlap with the
 * the target actor.
 * 
 * Hide is triggered whenever a window is near the screen border at a distance
 * less than the dock width, regardless of the dock vertical dimension.
 * 
*/

let intellihide = function(show, hide, target, settings) {

    this._init(show, hide, target, settings);
} 

intellihide.prototype = {

    _init: function(show, hide, target, settings) {

        this._settings = settings;
        this._loadSettings();
        if(this._settings){
            this._bindSettingsChanges();
        }

        // current intellihide status
        this.status;
        // Set base functions
        this.showFunction = show;
        this.hideFunction = hide;
        // Target object
        this.target = target;
        // Keep track of the current overview mode (I mean if it is on/off)
        this._inOverview = false;
        // dinstance from the border below which hide effect is triggered. It is update to match the dock width;
        this._offset = 0; 
        // It is automatically updated by the below signal:
        this._onSizeChange = this.target.connect('notify::width', Lang.bind(this, this._updateOffset));

        // Add signals on windows created from now on
        this._onWindowCreated = global.display.connect('window-created', Lang.bind(this, this._windowCreated));
        this._onSwitchWorkspace = global.window_manager.connect('switch-workspace', Lang.bind(this, this._switchWorkspace ));
        // trigggered for instance when a window is closed.
        this._onRestacked = global.screen.connect('restacked',  Lang.bind(this, this._updateDockVisibility ));

        // Set visibility in overview mode      
        this._onOverviewEnter = Main.overview.connect('showing', Lang.bind(this, this._overviewEnter));
        this._onOverviewExit = Main.overview.connect('hiding', Lang.bind(this,this._overviewExit));

        // Add signals to current windows
        this._initializeAllWindowSignals();

        // initialize: call show forcing to initialize status variable
        this._show(true);

        // update visibility
        this._updateOffset();
    },

    destroy: function() {
       
        // Clear global signals

        if (this._onWindowCreated) {
            global.display.disconnect(this._onWindowCreated);
            delete this._onWindowCreated;
        }

        if (this._onSwitchWorkspace) {
            global.window_manager.disconnect(this._onSwitchWorkspace);
            delete this._onSwitchWorkspace;
        }

        if (this._onRestacked) {
            global.screen.disconnect(this._onRestacked);
            delete this._onRestacked;
        }

        if (this._onOverviewEnter) {
            Main.overview.disconnect(this._onOverviewEnter);
            delete this._onOverviewEnter;
        }

        if (this._onOverviewExit) {
            Main.overview.disconnect(this._onOverviewExit);
            delete this._onOverviewExit;
        }

        // Clear signals on existing windows 

        global.get_window_actors().forEach(Lang.bind(this,function(wa) { 

            var the_window = wa.get_meta_window();

            this._removeWindowSignals(the_window);

         }));


    },

    _loadSettings: function(){

        if(this._settings) {

        let settings = this._settings;

            this._SETTINGS = {

                normal_mode: settings.get_enum('normal-mode'),
                overview_mode: settings.get_enum('overview-mode')
            };

        } else{

            this._SETTINGS = { 

                normal_mode: NORMAL_MODE,
                overview_mode: OVERVIEW_MODE
            };
        }
    },

    _bindSettingsChanges: function() {

        this._settings.connect('changed::normal-mode', Lang.bind(this, function(){
            this._SETTINGS['normal_mode'] = this._settings.get_enum('normal-mode');
            this._updateDockVisibility();
        }));
    },


    _show: function(force) {
        if (this.status==false || force){
            this.status = true;
            this.showFunction();
        }
    },

    _hide: function(force) {
        if (this.status==true || force){
            this.status = false;
            this.hideFunction();
        }
    },

    _updateOffset : function() {

        if(_DEBUG_) global.log("width: " + this.target.width);
        if(_DEBUG_) global.log("x: " + this.target.x);

        this._offset = this.target.width ;
        this._updateDockVisibility();
    },

    _overviewExit : function() {
        this._inOverview = false;
        this._updateDockVisibility();

    },

    _overviewEnter: function() {

        this._inOverview = true;
        if(this._SETTINGS['overview_mode'] == IntellihideMode.SHOW){
                this._show();
        } else if (this._SETTINGS['overview_mode'] == IntellihideMode.AUTOHIDE){
                this._hide();
        } else if (this._SETTINGS['overview_mode'] == IntellihideMode.INTELLIHIDE){
            this._show();
        } else if (this._SETTINGS['overview_mode'] == IntellihideMode.HIDE) {
            /*TODO*/
        }
    },

    _windowCreated: function(__unused_display, the_window) {

        this._addWindowSignals(the_window);

    },

    _addWindowSignals: function(the_window) {
            
            // Looking for a way to avoid to add custom variables ...
            the_window._micheledash_onPositionChanged = the_window.get_compositor_private().connect(
                'position-changed', Lang.bind(this, this._updateDockVisibility)
            );

            the_window._micheledash_onSizeChanged = the_window.get_compositor_private().connect(
                'size-changed', Lang.bind(this, this._updateDockVisibility)
            );

    },

    _removeWindowSignals: function(the_window) {
        
        var wa = the_window.get_compositor_private();

        if( the_window && the_window._micheledash_onSizeChanged ) {
               wa.disconnect(the_window._micheledash_onSizeChanged);
               delete the_window._micheledash_onSizeChanged;
        }

        if( the_window && the_window._micheledash_onPositionChanged ) {
               wa.disconnect(the_window._micheledash_onPositionChanged);
               delete the_window._micheledash_onPositionChanged;
        }
    },

    _switchWorkspace: function(shellwm, from, to, direction) {
        
        this._updateDockVisibility();

    },

    _updateDockVisibility: function() {

        // If we are in overview mode and the dock is set to be visible prevent 
        // it to be hidden by window events(window create, workspace change, 
        // window close...)

        if(this._inOverview){
            if( this._SETTINGS['overview_mode'] !== IntellihideMode.INTELLIHIDE ) {
                return;
            }
        }

        //else in normal mode:
        if(this._SETTINGS['normal_mode'] == IntellihideMode.AUTOHIDE){
            this._hide();
            return;
        }
        if(this._SETTINGS['normal_mode'] == IntellihideMode.SHOW){
            this._show();
            return;
        }
        else if(this._SETTINGS['normal_mode'] == IntellihideMode.HIDE){
            /*TODO*/
            return;
        } else if(this._SETTINGS['normal_mode'] == IntellihideMode.INTELLIHIDE){

            var edge;
            var ctr=0;

            // A closure for computing the minimum window position 
            var minEdge = function(wa){
                var meta_win = wa.get_meta_window();
                var left_edge = meta_win.get_outer_rect().x

                if(left_edge < edge || ctr==0){
                    edge=left_edge;
                }
                ctr++;
            };

            global.get_window_actors().filter(this._intellihideFilterInteresting, this).forEach(minEdge);

            if( edge < this._offset) {
                this._hide();
            } else {
                this._show();
            }
        }
    },

    // Filter interesting windows to be considered for intellihide.
    // Consider all windows visible on the current workspace.
    _intellihideFilterInteresting: function(wa, edge){

        var currentWorkspace = global.screen.get_active_workspace_index();

        var meta_win = wa.get_meta_window();
        if (!meta_win) {    //TODO michele: why? What does it mean?
            return false;
        }

        if ( !this._handledWindowType(meta_win) ) 
            return false;

        // keep only windows on the monitor where the dash is shown, 
        // the primary monitor at the moment.
        if (meta_win.get_monitor()!== Main.layoutManager.primaryIndex){
            return false
        }

        var wksp = meta_win.get_workspace();
        var wksp_index = wksp.index();

        if ( wksp_index == currentWorkspace && meta_win.showing_on_its_workspace() ) {
            return true;
        } else {
            return false;
        }

    },

    // Filter windows by type
    // inspired by Opacify@gnome-shell.localdomain.pl
    _handledWindowType: function(metaWindow) { 
        var wtype = metaWindow.get_window_type();
        for (var i = 0; i < handledWindowTypes.length; i++) {
            var hwtype = handledWindowTypes[i];
            if (hwtype == wtype) {
                return true;
            } else if (hwtype > wtype) {
                return false;
            }
        }
        return false;
    },

    _initializeAllWindowSignals: function () {
        
        global.get_window_actors().forEach(Lang.bind(this,function(wa) {

            var meta_win = wa.get_meta_window();
            if (!meta_win) {    //TODO michele: why? What does it mean?
                return;
            } 
            // First remove signals if already present. It should never happen 
            // if the extension is correctly unloaded.
            this._removeWindowSignals(meta_win);
            this._addWindowSignals(meta_win);

        }));
    }


};