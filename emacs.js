//=============================================================================

// File: "emacs.js"

// Copyright (c) 2014 by Marc Feeley, All Rights Reserved.

//=============================================================================

var emacs_keybindings = (function () {

  function print(obj) {
    var a = [], i;
    for (i in obj) {
      var val = obj[i];
      if (val instanceof Function)
        val = val.toString();
      else
        val = DlJSON.encode(val);
      a.push(DlJSON.encode(i) + " : " + val);
    }
    return a.map(function(line){
      return line.replace(/^/mg, function(s) {
        return "        ";
      });
    }).join("\n");
  }

  return print(Ymacs_Keymap_Emacs().constructor.KEYS);
})();

function createMenu(items) {
    var menu = items;
    if (items instanceof Array) {
        menu = new DlVMenu({});
        items.foreach(function(el) {
            if (el == "-") {
                menu.addSeparator();
            } else if (el instanceof DlWidget) {
                menu.appendWidget(el);
            } else {
                var id = el.id;
                if (!id) {
                    // generate an id for this item, if none given
                    id = el.label.replace(/[^a-z0-9_-]/gi, "");
                    id = id.toLowerCase();
                }
                var item = new DlMenuItem({ parent    : menu,
                                            id        : id,
                                            label     : el.label,
                                            iconClass : el.iconClass });
                if (el.handler)
                    item.addEventListener("onSelect", el.handler);
                if (el.items)
                    item.setMenu(createMenu(el.items));
            }
        });
    }
    return menu;
}

function setFrameStyle(style) {
  style.height = "";
  ymacs.frames.forEach(function(frame){
    frame.setStyle(style);
  });
  ymacs.minibuffer_frame.setStyle(style);
  ymacs.minibuffer_frame.getOverlaysContainer().style.height = "";
  ymacs.doLayout();
  ymacs.getActiveFrame().focus();
}

//-----------------------------------------------------------------------------

// Extend emacs keybindings.

Ymacs_Keymap_Emacs().defineKeys({
    "C-x C-c": "save_buffers_kill_terminal"
});

function remove_prompt(line) {
  return line.replace(/^(|[0-9]+(|\\[0-9]+))[>\?] /, "");
}

Ymacs_Buffer.newCommands({

  save_buffers_kill_terminal: function () {
    ymacs.getActiveBuffer().cmd("save_some_buffers_with_continuation", true, function () {
      ymacs.killTerminal(function () { });
    });
  },

  run_scheme: Ymacs_Interactive("", function () {
    ymacs.switchToBuffer(getSchemeBuffer());
  }),

  repl_enter: function () {
      var buf = this;
      var caret = buf.caretMarker.getPosition();
      var crc = buf._positionToRowCol(caret);
      var eob = buf.getCodeSize();
      var erc = buf._positionToRowCol(eob);
      var line = remove_prompt(buf.code[crc.row]);
      if (crc.row === erc.row) { // caret on last row
          buf._insertText("\n", eob);
          schemeProcessInput(line + "\n");
      } else {
          var last = buf.code[erc.row];
          var col = last.length - remove_prompt(last).length;
          buf._replaceText(buf._rowColToPosition(erc.row, col), eob, line);
      }
      buf.callInteractively("end_of_buffer");
  },

  repl_interrupt: function () {
    schemeProcessInterrupt();
  },

  repl_delete_char: function () {
    var buf = this;
    var caret = buf.caretMarker.getPosition();
    var eob = buf.getCodeSize();
    if (caret === eob && remove_prompt(buf.code[buf._positionToRowCol(caret).row]) === "") {
      schemeProcessInput(null); // end-of-file
    } else {
      buf.cmd("delete_char");
    }
}

});

function getSchemeBuffer() {
  var name = "*scheme*";
  var buf = ymacs.getBuffer(name);
  if (!buf) {
    buf = ymacs.createBuffer({ name:name });
    buf.cmd("lisp_mode");
    buf.cmd("repl_mode");
  }
  return buf;
}

function schemeProcessOutput(str) {
  var buf = getSchemeBuffer();
  buf._insertText(str, buf.getCodeSize());
  buf.cmd("ensure_caret_visible");
}

function schemeProcessInput(str) {
  alert("schemeProcessInput str=" + str);
}

function schemeProcessInterrupt() {
  alert("schemeProcessInterrupt");
}

//-----------------------------------------------------------------------------

// Setup ymacs.

var desktop = new DlDesktop({});
var layout = new DlLayout({ parent: desktop });
var ymacs = window.ymacs = new Ymacs({});

ymacs.setColorTheme([ "light", "standard" ]);

try {
    ymacs.getActiveBuffer().cmd("eval_file", ".ymacs");
} catch(ex) {}


// Menu bar

var menu_box = new DlVbox({});

menu_box.addSpace("menu_box_top_spacer");

menu_box.setStyle({ marginLeft: 0,
                    marginRight: 0,
                    backgroundColor: "#bbb",
                    color: "#000",
                    borderTop: "1px solid #fff"
                  });

var menu = new DlHMenu({parent: menu_box});

menu.setStyle({ marginLeft: 0,
                marginRight: 0,
                backgroundColor: "#bbb",
                color: "#000",
                borderBottom: "1px solid #000"
              });

// Theme submenu

var theme_submenu = new DlVMenu({});

[
    "light|y|Light background",
    "light|standard|>Emacs standard (default)",
    "light|andreas|>Andreas",
    "light|bharadwaj|>Bharadwaj",
    "light|gtk-ide|>GTK IDE",
    "light|high-contrast|>High contrast",
    "light|scintilla|>Scintilla",
    "light|standard-xemacs|>Standard XEmacs",
    "light|vim-colors|>Vim colors",
    null,
    "dark|y|Dark background",
    "dark|standard-dark|>Emacs standard",
    "dark|mishoo|>Mishoo's Emacs theme",
    "dark|billw|>Billw",
    "dark|charcoal-black|>Charcoal black",
    "dark|clarity-and-beauty|>Clarity and beauty",
    "dark|classic|>Classic",
    "dark|gnome2|>Gnome 2",
    "dark|calm-forest|>Calm forest",
    "dark|linh-dang-dark|>Linh Dang Dark",
    "dark|blue-mood|>Blue mood",
    "dark|zenburn|>Zenburn"

].foreach(function(theme){
    if (theme == null) {
        theme_submenu.addSeparator();
    } else {
        theme = theme.split(/\s*\|\s*/);
        var label = theme.pop();
        label = label.replace(/^>\s*/, "&nbsp;".x(4));
        var item = new DlMenuItem({ parent: theme_submenu, label: label });
        item.addEventListener("onSelect", function () {
          ymacs.setColorTheme(theme);
          ymacs.getActiveFrame().focus();
        });
    }
});

// Font family submenu

var ff_submenu = new DlVMenu({});

[
    "Lucida Sans Typewriter",
    "Andale Mono",
    "Courier New",
    "Arial",
    "Verdana",
    "Tahoma",
    "Georgia",
    "Times New Roman"

].foreach(function(font){
    item = new DlMenuItem({ parent: ff_submenu, label: "<span style='font-family:" + font + "'>" + font + "</span>" });
    item.addEventListener("onSelect", function(){
        setFrameStyle({ fontFamily: font });
    });
});

// Font size submenu

var fs_submenu = new DlVMenu({});

[
    "11px",
    "12px",
    "13px",
    "14px",
    "15px",
    "16px",
    "18px",
    "20px",
    "22px",
    "24px",
    "28px",
    "36px"

].foreach(function(font){
    item = new DlMenuItem({ parent: fs_submenu, label: "<span style='font-size:" + font + "'>" + font + "</span>" });
    item.addEventListener("onSelect", function(){
        setFrameStyle({ fontSize: font });
    });
});

// File menu

function file_visit_new_file() {
  ymacs.getActiveBuffer().callInteractively("find_file");
}

function file_save() {
  ymacs.getActiveBuffer().callInteractively("save_buffer");
}

function file_save_as() {
  ymacs.getActiveBuffer().callInteractively("write_file");
}

function file_quit() {
  ymacs.getActiveBuffer().callInteractively("save_buffers_kill_terminal");
}

var file_items = [
  { label: "Visit New File (C-x C-f)", handler: file_visit_new_file }
, { label: "Save (C-x C-s)",           handler: file_save }
, { label: "Save As... (C-x C-w)",     handler: file_save_as }
, { label: "Quit (C-x C-c)",           handler: file_quit }
];

menu.addSpace("first-menu-start");

var file_menu_item = new DlMenuItem({ parent: menu, label: "File" });
file_menu_item.setMenu(createMenu(file_items));

menu.addSpace();

// Edit menu

function edit_undo() {
  ymacs.getActiveBuffer().callInteractively("undo");
}

function edit_cut() {
  ymacs.getActiveBuffer().callInteractively("kill_region");
}

function edit_paste() {
  ymacs.getActiveBuffer().callInteractively("yank");
}

var edit_items = [
  { label: "Undo (C-x u)", handler: edit_undo }
, { label: "Cut (C-w)",    handler: edit_cut }
, { label: "Paste (C-y)",  handler: edit_paste }
];

var edit_menu_item = new DlMenuItem({ parent: menu, label: "Edit" });
edit_menu_item.setMenu(createMenu(edit_items));

menu.addSpace();

// Options menu

function options_setIndentationLevel() {
  var buf = ymacs.getActiveBuffer(), newIndent;
  newIndent = prompt("Indentation level for the current buffer: ", buf.getq("indent_level"));
  if (newIndent != null)
    newIndent = parseInt(newIndent, 10);
  if (newIndent != null && !isNaN(newIndent)) {
    buf.setq("indent_level", newIndent);
    buf.signalInfo("Done setting indentation level to " + newIndent);
  }
}

function options_toggleLineNumbers() {
  ymacs.getActiveBuffer().callInteractively("toggle_line_numbers");
}

var options_items = [
  { label: "Font Family", items: [ ff_submenu ] }
, { label: "Font Size", items: [ fs_submenu ] }
, { label: "Theme", items: [ theme_submenu ] }
, { label: "Set Indentation", handler: options_setIndentationLevel }
, { label: "Toggle Line Numbers", handler: options_toggleLineNumbers }
];

var options_menu_item = new DlMenuItem({ parent: menu, label: "Options" });
options_menu_item.setMenu(createMenu(options_items));

menu.addSpace();

// Buffers menu

var buffers_menu_item = new DlMenuItem({ parent: menu, label: "Buffers" });
var buffers_menu = new DlVMenu({});
function refresh_buffers_menu() {
  buffers_menu.destroyChildWidgets();
  ymacs.buffers.foreach(function(b) {
    var label = b.name;
    var id = label.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
    var item = new DlMenuItem({ parent : buffers_menu,
                                id     : id,
                                label  : label });
    item.addEventListener("onSelect", function () {
      ymacs._do_switchToBuffer(b);
    });
  });
}
buffers_menu_item.setMenu(buffers_menu,refresh_buffers_menu);

menu.addSpace();


// Help menu

function help_tutorial() {
}

function help_keybindings() {
  var help = ymacs.switchToBuffer("*Help*");
  help.setCode("Keybindings:\n\n" + emacs_keybindings);
}

var help_items = [
  { label: "Emacs Keybindings", handler: help_keybindings }
];

var help_menu_item = new DlMenuItem({ parent: menu, label: "Help" });
help_menu_item.setMenu(createMenu(help_items));

menu.addFiller();


// Layout

layout.packWidget(menu_box, { pos: "top" });
layout.packWidget(ymacs, { pos: "bottom", fill: "*" });

desktop.fullScreen();
desktop.callHooks("onResize");

{
  var scheme = getSchemeBuffer();
  ymacs.switchToBuffer(scheme);
  ymacs.killBuffer(ymacs.getBuffer("*scratch*"));
  scheme.signalInfo("<center>Welcome to Gambit-in-emacs-in-the-browser!<br/><br/>For help please check out the Help menu</center>", true, 10000);
}

//-----------------------------------------------------------------------------
