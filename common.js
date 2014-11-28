//=============================================================================

// File: "common.js"

// Copyright (c) 2014 by Marc Feeley, All Rights Reserved.

//=============================================================================

function print_keybindings(buf) {

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
    return a.join("\n")+"\n";
  }

  function print_keys(keymap) {
    return print(keymap.constructor.KEYS);
  }

  return buf.keymap.reverse().map(print_keys).join("");
}

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
  ymacs.setFrameStyle(style);
  ymacs.getActiveFrame().focus();
}

//-----------------------------------------------------------------------------

// Shell mode.

Ymacs_Buffer.newMode("shell_mode", function() {

    var keymap = Keymap_ShellMode();
    this.pushKeymap(keymap);

    return function() {
        this.popKeymap(keymap);
    };

});

DEFINE_SINGLETON("Keymap_ShellMode", Ymacs_Keymap, function(D, P){

    D.KEYS = {
        "ENTER"   : "shell_enter"
      , "C-d"     : "shell_delete_char_or_eof"
      , "C-c C-c" : "shell_interrupt"
    };

});

Ymacs_Buffer.newCommands({

  shell_delete_char_or_eof: function () {
    var self = this;
    var caret = self.caretMarker.getPosition();
    var eob = self.getCodeSize();
    if (caret === eob && remove_prompt(self.code[self._positionToRowCol(caret).row]) === "") {
      sendProcessInput(self.processId, null, function () { });
    } else {
      self.cmd("delete_char");
    }
  },

  shell_enter: function () {

    var self = this;

    function done() {
      self.callInteractively("end_of_buffer");
    }

    var caret = self.caretMarker.getPosition();
    var crc = self._positionToRowCol(caret);
    var eob = self.getCodeSize();
    var erc = self._positionToRowCol(eob);
    var line = remove_prompt(self.code[crc.row]);
    if (crc.row === erc.row) { // caret on last row?
      self._insertText("\n", eob);
      sendProcessInput(self.processId, line + "\n", done);
    } else {
      var last = self.code[erc.row];
      var col = last.length - remove_prompt(last).length;
      self._replaceText(self._rowColToPosition(erc.row, col), eob, line);
      done();
    }
  },

  shell_interrupt: function () {
    var self = this;
    sendProcessInterrupt(self.processId, function () { });
  },

  shell_toggle: function () {
    if (this === ymacs.getActiveBuffer())
      ymacs.switchToNextBuffer();
    else
      ymacs.switchToBuffer(this);
  },

  shell_send_input: function (input) {
    var self = this;
    var eob = self.getCodeSize();
    var erc = self._positionToRowCol(eob);
    var last = self.code[erc.row];
    var line = remove_prompt(last);
    var col = last.length - line.length;
    input += "\n";
    self._replaceText(self._rowColToPosition(erc.row, col), eob, "");

    appendToBuffer(self, input);

    sendProcessInput(self.processId, input, function () { });
  }

});

var process_table = {};

var end_of_line_re = new RegExp("\\n");
var error_filter_re = new RegExp("\\\"([^\\\"]*)\\\"@([0-9]+)\\.([0-9]+)");

function appendToBuffer(buf, text) {
  buf.preventUpdates();
  buf.cmd("end_of_buffer");
  buf.cmd("insert", text);
  buf.forAllFrames(function (frame) {
    frame.ensureCaretVisible();
    frame.redrawModelineWithTimer();
  });
  buf.resumeUpdates();
}

function receiveProcessOutput(processId, output) {

  var buf = process_table[processId];
  var eob = buf.getCodeSize();
  var last = buf.code[buf.code.length-1];

  appendToBuffer(buf, output);

  if (output.search(end_of_line_re) != -1) {
    var out = last + output;
    var rev_out = out.split("\n").slice(0, -1).reverse().join("\n");
    var err = rev_out.match(error_filter_re);
    if (err) {
      var name = err[1];
      var line = (+err[2])-1;
      var col = (+err[3])-1;
      pinpoint_file_split_with_shell_buffer(name, line, col, buf);
    }
  }
}

var shell_percent = 33;

function pinpoint_file_split_with_shell_buffer(name, line, col, shell_buf) {

  var aframe = ymacs.getActiveFrame();
  var shell_buf_frames = ymacs.getBufferFrames(shell_buf);

  function pinpoint(buf, buf_frames) {
    if (buf) {

      if (buf_frames.length === 0 || shell_buf_frames.length === 0) {
        // at least one of the buffers nbuf or buf is not visible
        var f = ymacs.getActiveFrame();
        var b = ymacs.getActiveBuffer();
        f.deleteOtherFrames();
        b.cmd("split_frame_vertically", 100-shell_percent);
        ymacs.switchToBuffer(buf);
        b.cmd("other_frame");
        ymacs.switchToBuffer(shell_buf);
        if (buf_frames.length === 0 ||
            shell_buf_frames.length > 0 && shell_buf_frames[0] === aframe) {
          aframe = ymacs.getActiveFrame();
        }
      }

      ymacs.setActiveFrame(ymacs.getBufferFrames(buf)[0]);
      buf.cmd("goto_char", buf._rowColToPosition(line, col));
      ymacs.setActiveFrame(aframe);
    }
  }

  var buf = ymacs.getBuffer(name);

  if (buf) {
    pinpoint(buf, ymacs.getBufferFrames(buf));
  } else {
    shell_buf.cmd("find_file_with_continuation", name, function () {
      pinpoint(ymacs.getBuffer(name), []);
    });
  }
}

function createShellBuffer(name, program, setup, cont) {
  var buf = ymacs.createBuffer({ name:name });
  setup(buf);
  buf.cmd("shell_mode");
  makeProcess(program, function (processId) {
      buf.processId = processId;
      process_table[processId] = buf;
      buf.addEventListener("onDeleteBuffer", function() {
        killProcess(processId, function () { });
      });
      startProcess(processId, function () {
        cont(buf);
      });
    });
}

function show_maybe_splitting(buf) {
  var buf_frames = ymacs.getBufferFrames(buf);
  if (buf_frames.length === 0) { // buffer not shown
    var f = ymacs.getActiveFrame();
    var b = ymacs.getActiveBuffer();
    f.deleteOtherFrames();
    b.cmd("split_frame_vertically", 100-shell_percent);
    b.cmd("other_frame");
    ymacs.switchToBuffer(buf);
    ymacs.setActiveFrame(f);
  }
}

//-----------------------------------------------------------------------------

// Scheme mode.

Ymacs_Keymap_SchemeMode().defineKeys({
    "C-c C-z"            : "scheme_toggle"
  , "C-c C-l && F11"     : "scheme_load_file"
  , "C-x C-e && M-ENTER" : "scheme_send_last_sexp"
  , "M-["                : "scheme_crawl_backtrace_older"
  , "M-]"                : "scheme_crawl_backtrace_newer"
  , "M-c"                : "scheme_continue"
  , "M-l"                : "scheme_leap_continuation"
  , "M-s"                : "scheme_step_continuation"
});

Ymacs_Buffer.newCommands({

  run_scheme: Ymacs_Interactive("", function () {
    withSchemeBuffer(function (buf) {
      ymacs.switchToBuffer(buf);
    }, true);
  }),

  scheme_toggle: Ymacs_Interactive("", function () {
    withSchemeBuffer(function (buf) {
      buf.cmd("shell_toggle");
    }, true);
  }),

  scheme_load_file: Ymacs_Interactive("", function () {
    var self = this;
    self.cmd("save_buffer_with_continuation", true, function () {
      withSchemeBuffer(function (buf) {
        buf.cmd("shell_send_input",
                "(load \"" + self.name + "\")");
      });
    });
  }),

  scheme_send_last_sexp: Ymacs_Interactive("", function () {
    var self = this;
    var p = self.point();
    var input;
    self.cmd("save_excursion", function() {
      self.cmd("backward_sexp");
      var begin = self.point();
      self.cmd("forward_sexp");
      var end = self.point();
      input = self._bufferSubstring(begin, end);
    });
    withSchemeBuffer(function (buf) {
      buf.cmd("shell_send_input", input);
    });
  }),

  scheme_crawl_backtrace_older: Ymacs_Interactive("", function () {
    withSchemeBuffer(function (buf) {
      buf.cmd("shell_send_input", ",+");
    });
  }),

  scheme_crawl_backtrace_newer: Ymacs_Interactive("", function () {
    withSchemeBuffer(function (buf) {
      buf.cmd("shell_send_input", ",-");
    });
  }),

  scheme_continue: Ymacs_Interactive("", function () {
    withSchemeBuffer(function (buf) {
      buf.cmd("shell_send_input", ",c");
    });
  }),

  scheme_leap_continuation: Ymacs_Interactive("", function () {
    withSchemeBuffer(function (buf) {
      buf.cmd("shell_send_input", ",l");
    });
  }),

  scheme_step_continuation: Ymacs_Interactive("", function () {
    withSchemeBuffer(function (buf) {
      buf.cmd("shell_send_input", ",s");
    });
  })

});

function withSchemeBuffer(cont, prevent_split) {

  function done(buf) {
    if (!prevent_split)
      show_maybe_splitting(buf);
    cont(buf);
  }

  var name = "*scheme*";
  var buf = ymacs.getBuffer(name);
  if (buf)
    done(buf);
  else
    createShellBuffer(name, "##repl-debug-main", function (buf) {
      buf.cmd("scheme_mode");
    }, done);
}

//-----------------------------------------------------------------------------

// Extend emacs keybindings.

Ymacs_Keymap_Emacs().defineKeys({
    "C-x C-c": "save_buffers_kill_terminal"
  , "C-h C-a": "about_emacs"
  , "C-h t"  : "help_emacs_tutorial"
  , "C-h b"  : "describe_bindings"
});

function remove_prompt(line) {
  return line.replace(/^(|[0-9]+(|\\[0-9]+))[>\?] /, "");
}

Ymacs_Buffer.newCommands({

  save_buffers_kill_terminal: Ymacs_Interactive("", function () {
    ymacs.getActiveBuffer().cmd("save_some_buffers_with_continuation", true, function () {
      ymacs.killTerminal(function () { });
    });
  }),

  about_emacs: Ymacs_Interactive("", function () {
    var buf = ymacs.switchToBuffer("*About Emacs*");
    buf.setCode(about_text);
  }),

  help_emacs_tutorial: Ymacs_Interactive("", function () {
    var buf = ymacs.switchToBuffer("*Emacs Tutorial*");
    buf.setCode(tutorial_text);
  }),

  help_scheme_mode_tutorial: Ymacs_Interactive("", function () {
    var buf = ymacs.switchToBuffer("*Scheme Mode Tutorial*");
    buf.setCode(scheme_mode_tutorial_text);
  }),

  describe_bindings: Ymacs_Interactive("", function () {
    var keybindings = print_keybindings(this);
    var buf = ymacs.switchToBuffer("*Keybindings*");
    buf.setCode(keybindings);
  })

});

var about_text = "This emacs variant combines the\n\
following open-source softwares:\n\
\n\
- ymacs: an emacs-like editor created by\n\
  Mihai C\u0103lin Bazon (http://www.ymacs.org)\n\
\n\
- Gambit: a Scheme system created by\n\
  Marc Feeley (http://gambitscheme.org).\n\
\n\
If you would like to see new features added,\n\
please consider contributing to their source\n\
code repositories on github.  Improvements\n\
will eventually trickle back here.\n\
\n\
  https://github.com/mishoo/ymacs\n\
  https://github.com/feeley/gambit\n\
";

var tutorial_text = "Editing commands are bound to keystrokes\n\
that involve the use of the CONTROL key and\n\
the META key (sometimes labeled COMMAND or\n\
ALT).  The notation C-<char> means typing\n\
the <char> while holding down the CONTROL\n\
key.  Similarly, M-<char> means typing the\n\
<char> while holding down the META key.\n\
Alternatively, the same effect as M-<char>\n\
can be obtained by the two key sequence:\n\
ESC key followed by <char>.\n\
\n\
Some commands are invoked by a single\n\
keystroke (such as C-v to move the cursor\n\
one page down and M-v to move the cursor\n\
one page up), while others require a\n\
sequence of two or more keys (such as\n\
C-x C-f to start editing a file).\n\
\n\
This tutorial explains the most frequently\n\
used keybindings.  A complete list of\n\
keybindings can be obtained with C-h b.\n\
Note that most keybindings are identical to\n\
those of GNU Emacs so there should be few\n\
surprizes for experienced Emacs users.  The\n\
GNU Emacs manual is available here:\n\
\n\
  http://www.gnu.org/software/emacs/manual/emacs.html\n\
\n\
CURSOR MOVEMENT\n\
---------------\n\
\n\
Moving the cursor around is accomplished\n\
with the arrow keys or the keystrokes:\n\
\n\
  C-f : move cursor one character forward\n\
  C-b : move cursor one character backward\n\
  C-n : move cursor to next line\n\
  C-p : move cursor to previous line\n\
  C-a : move cursor to beginning of line\n\
  C-e : move cursor to end of line\n\
  C-v : move cursor one page down\n\
  M-v : move cursor one page up\n\
  M-< : move cursor to beginning of whole text\n\
  M-> : move cursor to end of whole text\n\
  C-l : scroll the text so that cursor is in\n\
        the center of the screen\n\
\n\
REPEATING COMMANDS\n\
------------------\n\
\n\
Many commands can be repeated N times by\n\
prefixing them with C-u N.  For example the\n\
sequence C-u 8 0 C-f will advance the\n\
cursor by 80 characters and C-u 5 * will\n\
insert ***** in the text.\n\
\n\
INSERTING AND DELETING TEXT\n\
---------------------------\n\
\n\
Ordinary characters are inserted as you\n\
type them. The backspace key can be used to\n\
delete the character immediately before the\n\
cursor.  C-d deletes the character at the\n\
cursor position.\n\
\n\
C-k \"kills\" the remaining part of the\n\
line from the cursor position.  Killed text\n\
is saved internally and immediately typing\n\
C-k again keeps adding to the killed text.\n\
The killed text can later be \"yanked\"\n\
using C-y.  Note that kill and yank are the\n\
emacs terms for the common terms \"cut\"\n\
and \"paste\".\n\
\n\
An arbitrary segment of text can be killed\n\
by moving to one end of the segment and\n\
typing C-<SPACE> to \"mark\" that location,\n\
then moving the cursor to the other end of\n\
the segment, and typing C-w to kill the\n\
section between the cursor and the mark.\n\
\n\
CANCELING COMMANDS AND UNDO\n\
---------------------------\n\
\n\
A C-g can be used to cancel a partially\n\
entered editing command.\n\
\n\
The last editing command can be undone\n\
using C-/.  To continue undoing more\n\
commands, use C-/ repeatedly.\n\
\n\
BUFFERS AND FILES\n\
-----------------\n\
\n\
While it is being edited, text is held in a\n\
\"buffer\".  Visiting a file with the\n\
command C-x C-f creates a buffer and copies\n\
the contents of the file to it.  The\n\
editing commands operate on the contents of\n\
the buffer and an explicit command, C-x\n\
C-s, is required to save the contents of\n\
the buffer back to the corresponding file.\n\
A buffer can also be written to a different\n\
file with C-x C-w.  Note however that some\n\
buffers, such as the current one and those\n\
beginning and ending in an asterisk, are\n\
not linked to a file.\n\
\n\
In general, multiple buffers are managed by\n\
the editor, but typically only one is shown\n\
in one screen-size frame.  The current\n\
frame can be split in 2 using the commands\n\
C-x 2 (vertical split) and C-x 3\n\
(horizontal split).  The focused frame can\n\
be changed with C-x o.  Finally, C-x 1\n\
deletes all frames but the currently\n\
focused one.  The buffer being shown in a\n\
frame can be changed with the command C-x\n\
b, or by selecting the buffer in the\n\
\"Buffers\" menu.  The command C-x k kills\n\
the current buffer.\n\
\n\
OTHER USEFUL COMMANDS\n\
---------------------\n\
\n\
Here are other frequently used editing\n\
commands:\n\
\n\
  C-s : incremental search (forward)\n\
  C-r : incremental search (backward)\n\
  M-/ : autocomplete current word\n\
  C-x ( : start defining a macro\n\
  C-x ) : end defining a macro\n\
  C-x e : execute macro\n\
";

var scheme_mode_tutorial_text = "Scheme mode is activated automatically\n\
in the Gambit REPL buffer (*scheme*) and\n\
in buffers visiting Scheme source code\n\
files with extension \".scm\".  It can\n\
be activated explicitly with the command\n\
M-x scheme_mode.\n\
\n\
Scheme mode facilitates the development of\n\
programs by providing Scheme specific\n\
syntax highlighting, parenthesis matching,\n\
autoindent, S-expression navigation, error\n\
location pinpointing and commands to\n\
interact with the Gambit REPL.\n\
\n\
C-c C-z toggles the current buffer between\n\
the Gambit REPL buffer and the most\n\
recently viewed buffer.\n\
\n\
M-ENTER evaluates the expression before the\n\
cursor by sending it to the REPL.  If the\n\
REPL buffer is not currently visible, the\n\
frame will be split to show the source code\n\
file on the top and the REPL on the bottom,\n\
allowing easy viewing of the result of the\n\
expression evaluation.  It is convenient to\n\
edit a Scheme source code file and to use\n\
M-ENTER to test various parts of the code\n\
as they are being written.  C-x C-e is\n\
equivalent to M-ENTER.\n\
\n\
The current file can be loaded by the\n\
Gambit interpreter with C-c C-l.  This\n\
sends (load \"<buffer-name>\") to the REPL.\n\
\n\
Shortcuts are available to access the\n\
REPL's debugging commands:\n\
\n\
  M-s : ,s (step)\n\
  M-l : ,l (leap)\n\
  M-c : ,c (continue)\n\
  M-[ : ,+ (move to next frame)\n\
  M-] : ,- (move to previous frame)\n\
\n\
When the REPL displays an error message,\n\
the location information in the message is\n\
used to display the file where the error\n\
occurred and to move the cursor to the\n\
location of the error.  This also works\n\
when single-stepping code making it easy to\n\
follow the evaluation steps.  For example,\n\
assume the file foo.scm contains the code:\n\
\n\
(define (len lst)\n\
  (if (null? lst)\n\
      0\n\
      (+ 1 (len (cdr lst)))))\n\
\n\
(step)\n\
\n\
(len '(1 2 3))\n\
\n\
Then when (load \"foo.scm\") is evaluated the\n\
interpreter will display the message\n\
\n\
*** STOPPED IN \"foo.scm\"@8.2\n\
\n\
because after single stepping is turned on\n\
by the call (step) the next expression\n\
evaluated is the reference to len on line\n\
8, column 2 (the last line of code).  This\n\
will cause the frame to be split with the\n\
REPL on the bottom and the file foo.scm on\n\
top with the cursor on line 8, column 2.\n\
Subsequent single steps (by entering ,s or\n\
M-s) will move the cursor to follow the\n\
execution point.\n\
\n\
At the Gambit REPL the key C-d on an empty\n\
line generates an end-of-file (useful to\n\
exit nested REPLs created by errors).  The\n\
command C-c C-c sends an interrupt to the\n\
Gambit interpreter (useful to abort long\n\
evaluations and infinite loops).\n\
";

//-----------------------------------------------------------------------------

// Setup ymacs.

var desktop = new DlDesktop({});
var layout = new DlLayout({ parent: desktop });
var ymacs = window.ymacs = new Ymacs({});

ymacs.setColorTheme([ "light", "standard" ]);


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
    "10px",
    "11px",
    "12px",
    "14px",
    "16px",
    "18px",
    "20px",
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

function help_about() {
  ymacs.getActiveBuffer().callInteractively("about_emacs");
}

function help_emacs_tutorial() {
  ymacs.getActiveBuffer().callInteractively("help_emacs_tutorial");
}

function help_scheme_mode_tutorial() {
  ymacs.getActiveBuffer().callInteractively("help_scheme_mode_tutorial");
}

function help_keybindings() {
  ymacs.getActiveBuffer().callInteractively("describe_bindings");
}

function help_scheme_keybindings() {
  ymacs.getActiveBuffer().callInteractively("describe_scheme_bindings");
}

var help_items = [
  { label: "About Emacs (C-h C-a)",   handler: help_about }
, { label: "Emacs Tutorial (C-h t)",  handler: help_emacs_tutorial }
, { label: "Scheme Mode Tutorial",    handler: help_scheme_mode_tutorial }
, { label: "Keybindings (C-h b)",     handler: help_keybindings }
];

var help_menu_item = new DlMenuItem({ parent: menu, label: "Help" });
help_menu_item.setMenu(createMenu(help_items));

menu.addFiller();


// Layout

layout.packWidget(menu_box, { pos: "top" });
layout.packWidget(ymacs, { pos: "bottom", fill: "*" });

desktop.fullScreen();
desktop.callHooks("onResize");

function visitFiles(names, cont) {

  function next() {
    if (names.length > 0)
      ymacs.getActiveBuffer().cmd("find_file_with_continuation", names.shift(), next);
    else
      cont();
  }

  next();
}

function setupEmacs() {

  try {
    ymacs.getActiveBuffer().cmd("eval_file", ".ymacs");
  } catch (ex) {}

  if ("filesToVisit" in this && filesToVisit.length > 0) {
    visitFiles(filesToVisit, function () {
      ymacs.killBuffer(ymacs.getBuffer("*scratch*"));
    });
  } else {
    withSchemeBuffer(function (buf) {
      ymacs.killBuffer(ymacs.getBuffer("*scratch*"));
    }, true);
    ymacs.getActiveBuffer().signalInfo("<center>For help please use the Help menu</center>", true, 5000);
  }
}

//=============================================================================
