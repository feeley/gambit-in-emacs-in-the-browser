//=============================================================================

// File: "gambit-in-emacs-in-the-browser.js"

// Copyright (c) 2013-2014 by Marc Feeley, All Rights Reserved.

//=============================================================================

// Filesystem implementation for GambitREPL app.

function milliseconds(d) {
  return d.getTime()*1000 + d.getMilliseconds();
}

function file_milliseconds(path) {
  var s = null;
  try {
    s = FS.stat(path);
  } catch (e) {
  }
  if (s === null)
    return null;
  else
    return milliseconds(s.mtime);
}

function fs_fileType(path, cont) {
  var s = null;
  try {
    s = FS.stat(path);
  } catch (e) {
  }
  if (s === null)
    cont(null);
  else if (FS.isDir(s.mode))
    cont("directory");
  else
    cont("regular");
}

Ymacs.prototype.fs_fileType = function (path, cont) {
  fs_fileType(path, cont);
};

function fs_getDirectory(path, cont) {
  var d = null;
  if (path.length === 0 && path[path.length-1] !== "/")
    path += "/";
  try {
    d = FS.readdir(path);
  } catch (e) {
  }
  if (d === null) {
    cont(null);
  } else {
    var files = {};
    for (var i=0; i<d.length; i++) {
      var f = d[i];
      if (f !== "." && f !== "..") {
        var p = path + f;
        var s = FS.stat(p);
        files[f] = { name:f,
                     path:p,
                     type: FS.isDir(s.mode) ? "directory" : "regular"
                   };
      }
    }
    cont(files);
  }
}

Ymacs.prototype.fs_getDirectory = function (path, cont) {
  fs_getDirectory(path, cont);
};

function fs_getFileContents(path, nothrow, cont) {
  var s = null;
  try {
    s = FS.stat(path);
  } catch (e) {
  }
  if (s === null) {
    cont(null, null);
  } else {
    var content;
    try {
      content = FS.readFile(path, {encoding:"utf8"});
    } catch (e) {
    }
    if (content === null) {
      cont(null, null);
    } else {
      cont(content, file_milliseconds(path));
    }
  }
}

Ymacs.prototype.fs_getFileContents = function (path, nothrow, cont) {
  fs_getFileContents(path, nothrow, cont);
};

function create_parent_dirs(path) {
  if (path.length > 0 && path[path.length-1] === "/")
    path = path.slice(0, -1);
  var parent = path.slice(0, path.lastIndexOf("/"));
  if (parent.length > 0)
    create_parent_dirs(parent);
  if (file_milliseconds(parent) === null) {
    try {
      FS.mkdir(parent);
    } catch (e) {
    }
  }
}

function fs_setFileContents(path, content, stamp, cont) {

  function write() {
    create_parent_dirs(path);
    try {
      FS.writeFile(path, content, {encoding:"utf8"});
    } catch (e) {
    }
    cont(file_milliseconds(path));
  }

  if (stamp !== null) {
    if (file_milliseconds(path) !== stamp) {
      cont(null);
    } else {
      write();
    }
  } else {
    write();
  }
}

Ymacs.prototype.fs_setFileContents = function (path, content, stamp, cont) {
  fs_setFileContents(path, content, stamp, cont);
};

function fs_deleteFile(path, cont) {
  var s = null;
  try {
    s = FS.stat(path);
  } catch (e) {
  }
  if (s !== null) {
    if (FS.isDir(s.mode)) {
      FS.rmdir(path);
    } else {
      FS.unlink(path);
    }
  }
  cont();
}

Ymacs.prototype.fs_deleteFile = function (path, cont) {
  fs_deleteFile(path, cont);
};

function fs_remapDir(path, cont) {
  if (0 && path === "") {
    cont(FS.cwd());
  } else {
    cont(path);
  }
}

Ymacs.prototype.fs_remapDir = function (path, cont) {
  fs_remapDir(path, cont);
};

function killTerminal(cont) {
  cont();
}

Ymacs.prototype.killTerminal = function (cont) {
  killTerminal(cont);
};

function makeProcess(process, cont) {
  if (process === "##repl-debug-main")
    cont(0);
  else
    cont(null);
}

function startProcess(processId, cont) {
  if (processId === 0)
    Module.schemeStart(); // run Gambit Scheme interpreter
  cont();
}

function killProcess(processId, cont) {
  cont();
}

function sendProcessInterrupt(processId, cont) {
  if (processId === 0)
    schemeProcessInterrupt();
  cont();
}

function sendProcessInput(processId, input, cont) {
  if (processId === 0)
    schemeProcessInput(input);
  cont();
}

//-----------------------------------------------------------------------------

// Interface to emscripten compiled Gambit Scheme interpreter.

var Module = {};

Module.stdin_buffer = [];

Module.stdin = function () {
  if (Module.stdin_buffer.length === 0) {
    return undefined;
  } else {
    return Module.stdin_buffer.shift();
  }
};

Module.stdout = function (c) {
  if (c !== null) {
    receiveProcessOutput(0, String.fromCharCode(c));
  }
};

function schemeProcessInput(input) {
  if (input === null) { // EOF
    Module.stdin_buffer.push(null);
  } else {
    var bytes = intArrayFromString(input);
    bytes.pop(); // remove NUL at end
    Module.stdin_buffer = Module.stdin_buffer.concat(bytes);
  }
}

function schemeProcessInterrupt() {
  _user_interrupt();
}

Module.stderr = Module.stdout;

Module.setupTTYIO = function () {

  // redirect TTY I/O to stdin and stdout

  var ops = {
    get_char: function (tty) {
      return Module.stdin();
    },
    put_char: function (tty, c) {
      return Module.stdout(c);
    }
  };

  TTY.register(FS.makedev(5, 0), ops); // redirect /dev/tty
  TTY.register(FS.makedev(6, 0), ops); // redirect /dev/tty1
};

Module.preRun = [Module.setupTTYIO];

// Scheme code execution driver

Module.schemeDriver = function () {

  function step_scheme() {
    _heartbeat_interrupt();
    var wait = _idle();
    if (wait < 0) {
      _cleanup();
    } else {
      //console.log('wait=' + wait);
      setTimeout(step_scheme, Math.max(1, Math.round(1000*wait)));
    }
  };

  _setup();
  step_scheme();
};

Module.schemeStart = function () {
  run();
  Module.schemeDriver(); // run the Scheme code
};

//=============================================================================
