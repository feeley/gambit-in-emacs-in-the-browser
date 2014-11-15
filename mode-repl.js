// @require ymacs-tokenizer.js

DEFINE_SINGLETON("Keymap_ReplMode", Ymacs_Keymap, function(D, P){

    D.KEYS = {
        "ENTER"   : "repl_enter"
      , "C-c C-c" : "repl_interrupt"
      , "C-d"     : "repl_delete_char"
    };

});

Ymacs_Buffer.newMode("repl_mode", function() {

    var keymap = Keymap_ReplMode();
    this.pushKeymap(keymap);

    return function() {
        this.popKeymap(keymap);
    };

});
