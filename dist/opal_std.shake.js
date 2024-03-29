(function() {
  "use strict";

  // @note
  //   A few conventions for the documentation of this file:
  //   1. Always use "//" (in contrast with "/**/")
  //   2. The syntax used is Yardoc (yardoc.org), which is intended for Ruby (se below)
  //   3. `@param` and `@return` types should be preceded by `JS.` when referring to
  //      JavaScript constructors (e.g. `JS.Function`) otherwise Ruby is assumed.
  //   4. `nil` and `null` being unambiguous refer to the respective
  //      objects/values in Ruby and JavaScript
  //   5. This is still WIP :) so please give feedback and suggestions on how
  //      to improve or for alternative solutions
  //
  //   The way the code is digested before going through Yardoc is a secret kept
  //   in the docs repo (https://github.com/opal/docs/tree/master).

  var global_object = this, console;

  // Detect the global object
  if (typeof(global) !== 'undefined') { global_object = global; }
  if (typeof(window) !== 'undefined') { global_object = window; }

  // Setup a dummy console object if missing
  if (typeof(global_object.console) === 'object') {
    console = global_object.console;
  } else if (global_object.console == null) {
    console = global_object.console = {};
  } else {
    console = {};
  }

  if (!('log' in console)) { console.log = function () {}; }
  if (!('warn' in console)) { console.warn = console.log; }

  if (typeof(global_object.Opal) !== 'undefined') {
    console.warn('Opal already loaded. Loading twice can cause troubles, please fix your setup.');
    return global_object.Opal;
  }

  var nil;

  // The actual class for BasicObject
  var BasicObject;

  // The actual Object class.
  // The leading underscore is to avoid confusion with window.Object()
  var _Object;

  // The actual Module class
  var Module;

  // The actual Class class
  var Class;

  // The Opal object that is exposed globally
  var Opal = global_object.Opal = {};

  // This is a useful reference to global object inside ruby files
  Opal.global = global_object;
  global_object.Opal = Opal;

  // Configure runtime behavior with regards to require and unsupported features
  Opal.config = {
    missing_require_severity: 'error',        // error, warning, ignore
    unsupported_features_severity: 'warning', // error, warning, ignore
    enable_stack_trace: true                  // true, false
  };

  // Minify common function calls
  var $hasOwn       = Object.hasOwnProperty;
  var $bind         = Function.prototype.bind;
  var $setPrototype = Object.setPrototypeOf;
  var $slice        = Array.prototype.slice;
  var $splice       = Array.prototype.splice;

  // Nil object id is always 4
  var nil_id = 4;

  // Generates even sequential numbers greater than 4
  // (nil_id) to serve as unique ids for ruby objects
  var unique_id = nil_id;

  // Return next unique id
  Opal.uid = function() {
    unique_id += 2;
    return unique_id;
  };

  // Retrieve or assign the id of an object
  Opal.id = function(obj) {
    if (obj.$$is_number) return (obj * 2)+1;
    if (obj.$$id != null) {
      return obj.$$id;
    }
    $defineProperty(obj, '$$id', Opal.uid());
    return obj.$$id;
  };

  // Globals table
  Opal.gvars = {};

  // Exit function, this should be replaced by platform specific implementation
  // (See nodejs and chrome for examples)
  ;

  // keeps track of exceptions for $!
  Opal.exceptions = [];

  // @private
  // Pops an exception from the stack and updates `$!`.
  Opal.pop_exception = function() {
    Opal.gvars["!"] = Opal.exceptions.pop() || nil;
  };

  // Inspect any kind of object, including non Ruby ones
  Opal.inspect = function(obj) {
    if (obj === undefined) {
      return "undefined";
    }
    else if (obj === null) {
      return "null";
    }
    else if (!obj.$$class) {
      return obj.toString();
    }
    else {
      return obj.$inspect();
    }
  };

  function $defineProperty(object, name, initialValue) {
    if (typeof(object) === "string") {
      // Special case for:
      //   s = "string"
      //   def s.m; end
      // String class is the only class that:
      // + compiles to JS primitive
      // + allows method definition directly on instances
      // numbers, true, false and null do not support it.
      object[name] = initialValue;
    } else {
      Object.defineProperty(object, name, {
        value: initialValue,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
  }

  Opal.defineProperty = $defineProperty;

  Opal.slice = $slice;


  // Truth
  // -----

  Opal.truthy = function(val) {
    return (val !== nil && val != null && (!val.$$is_boolean || val == true));
  };

  Opal.falsy = function(val) {
    return (val === nil || val == null || (val.$$is_boolean && val == false))
  };


  // Constants
  // ---------
  //
  // For future reference:
  // - The Rails autoloading guide (http://guides.rubyonrails.org/v5.0/autoloading_and_reloading_constants.html)
  // - @ConradIrwin's 2012 post on “Everything you ever wanted to know about constant lookup in Ruby” (http://cirw.in/blog/constant-lookup.html)
  //
  // Legend of MRI concepts/names:
  // - constant reference (cref): the module/class that acts as a namespace
  // - nesting: the namespaces wrapping the current scope, e.g. nesting inside
  //            `module A; module B::C; end; end` is `[B::C, A]`

  // Get the constant in the scope of the current cref
  function const_get_name(cref, name) {
    if (cref) return cref.$$const[name];
  }

  // Walk up the nesting array looking for the constant
  function const_lookup_nesting(nesting, name) {
    var i, ii, constant;

    if (nesting.length === 0) return;

    // If the nesting is not empty the constant is looked up in its elements
    // and in order. The ancestors of those elements are ignored.
    for (i = 0, ii = nesting.length; i < ii; i++) {
      constant = nesting[i].$$const[name];
      if (constant != null) return constant;
    }
  }

  // Walk up the ancestors chain looking for the constant
  function const_lookup_ancestors(cref, name) {
    var i, ii, ancestors;

    if (cref == null) return;

    ancestors = Opal.ancestors(cref);

    for (i = 0, ii = ancestors.length; i < ii; i++) {
      if (ancestors[i].$$const && $hasOwn.call(ancestors[i].$$const, name)) {
        return ancestors[i].$$const[name];
      }
    }
  }

  // Walk up Object's ancestors chain looking for the constant,
  // but only if cref is missing or a module.
  function const_lookup_Object(cref, name) {
    if (cref == null || cref.$$is_module) {
      return const_lookup_ancestors(_Object, name);
    }
  }

  // Call const_missing if nothing else worked
  function const_missing(cref, name, skip_missing) {
    if (!skip_missing) {
      return (cref || _Object).$const_missing(name);
    }
  }

  // Look for the constant just in the current cref or call `#const_missing`
  Opal.const_get_local = function(cref, name, skip_missing) {
    var result;

    if (cref == null) return;

    if (cref === '::') cref = _Object;

    if (!cref.$$is_module && !cref.$$is_class) {
      throw new Opal.TypeError(cref.toString() + " is not a class/module");
    }

    result = const_get_name(cref, name);              if (result != null) return result;
    result = const_missing(cref, name, skip_missing); if (result != null) return result;
  };

  // Look for the constant relative to a cref or call `#const_missing` (when the
  // constant is prefixed by `::`).
  Opal.const_get_qualified = function(cref, name, skip_missing) {
    var result, cache, cached, current_version = Opal.const_cache_version;

    if (cref == null) return;

    if (cref === '::') cref = _Object;

    if (!cref.$$is_module && !cref.$$is_class) {
      throw new Opal.TypeError(cref.toString() + " is not a class/module");
    }

    if ((cache = cref.$$const_cache) == null) {
      $defineProperty(cref, '$$const_cache', Object.create(null));
      cache = cref.$$const_cache;
    }
    cached = cache[name];

    if (cached == null || cached[0] !== current_version) {
      ((result = const_get_name(cref, name))              != null) ||
      ((result = const_lookup_ancestors(cref, name))      != null);
      cache[name] = [current_version, result];
    } else {
      result = cached[1];
    }

    return result != null ? result : const_missing(cref, name, skip_missing);
  };

  // Initialize the top level constant cache generation counter
  Opal.const_cache_version = 1;

  // Look for the constant in the open using the current nesting and the nearest
  // cref ancestors or call `#const_missing` (when the constant has no :: prefix).
  Opal.const_get_relative = function(nesting, name, skip_missing) {
    var cref = nesting[0], result, current_version = Opal.const_cache_version, cache, cached;

    if ((cache = nesting.$$const_cache) == null) {
      $defineProperty(nesting, '$$const_cache', Object.create(null));
      cache = nesting.$$const_cache;
    }
    cached = cache[name];

    if (cached == null || cached[0] !== current_version) {
      ((result = const_get_name(cref, name))              != null) ||
      ((result = const_lookup_nesting(nesting, name))     != null) ||
      ((result = const_lookup_ancestors(cref, name))      != null) ||
      ((result = const_lookup_Object(cref, name))         != null);

      cache[name] = [current_version, result];
    } else {
      result = cached[1];
    }

    return result != null ? result : const_missing(cref, name, skip_missing);
  };

  // Register the constant on a cref and opportunistically set the name of
  // unnamed classes/modules.
  Opal.const_set = function(cref, name, value) {
    if (cref == null || cref === '::') cref = _Object;

    if (value.$$is_a_module) {
      if (value.$$name == null || value.$$name === nil) value.$$name = name;
      if (value.$$base_module == null) value.$$base_module = cref;
    }

    cref.$$const = (cref.$$const || Object.create(null));
    cref.$$const[name] = value;

    // Add a short helper to navigate constants manually.
    // @example
    //   Opal.$$.Regexp.$$.IGNORECASE
    cref.$$ = cref.$$const;

    Opal.const_cache_version++;

    // Expose top level constants onto the Opal object
    if (cref === _Object) Opal[name] = value;

    // Name new class directly onto current scope (Opal.Foo.Baz = klass)
    $defineProperty(cref, name, value);

    return value;
  };

  // Get all the constants reachable from a given cref, by default will include
  // inherited constants.
  Opal.constants = function(cref, inherit) {
    if (inherit == null) inherit = true;

    var module, modules = [cref], i, ii, constants = {}, constant;

    if (inherit) modules = modules.concat(Opal.ancestors(cref));
    if (inherit && cref.$$is_module) modules = modules.concat([Opal.Object]).concat(Opal.ancestors(Opal.Object));

    for (i = 0, ii = modules.length; i < ii; i++) {
      module = modules[i];

      // Do not show Objects constants unless we're querying Object itself
      if (cref !== _Object && module == _Object) break;

      for (constant in module.$$const) {
        constants[constant] = true;
      }
    }

    return Object.keys(constants);
  };

  // Remove a constant from a cref.
  ;

  // Setup some shortcuts to reduce compiled size
  Opal.$$ = Opal.const_get_relative;
  Opal.$$$ = Opal.const_get_qualified;


  // Modules & Classes
  // -----------------

  // A `class Foo; end` expression in ruby is compiled to call this runtime
  // method which either returns an existing class of the given name, or creates
  // a new class in the given `base` scope.
  //
  // If a constant with the given name exists, then we check to make sure that
  // it is a class and also that the superclasses match. If either of these
  // fail, then we raise a `TypeError`. Note, `superclass` may be null if one
  // was not specified in the ruby code.
  //
  // We pass a constructor to this method of the form `function ClassName() {}`
  // simply so that classes show up with nicely formatted names inside debuggers
  // in the web browser (or node/sprockets).
  //
  // The `scope` is the current `self` value where the class is being created
  // from. We use this to get the scope for where the class should be created.
  // If `scope` is an object (not a class/module), we simple get its class and
  // use that as the scope instead.
  //
  // @param scope        [Object] where the class is being created
  // @param superclass  [Class,null] superclass of the new class (may be null)
  // @param id          [String] the name of the class to be created
  // @param constructor [JS.Function] function to use as constructor
  //
  // @return new [Class]  or existing ruby class
  //
  Opal.allocate_class = function(name, superclass) {
    var klass, constructor;

    if (superclass != null && superclass.$$bridge) {
      // Inheritance from bridged classes requires
      // calling original JS constructors
      constructor = function() {
        var args = $slice.call(arguments),
            self = new ($bind.apply(superclass.$$constructor, [null].concat(args)))();

        // and replacing a __proto__ manually
        $setPrototype(self, klass.$$prototype);
        return self;
      }
    } else {
      constructor = function(){};
    }

    if (name) {
      $defineProperty(constructor, 'displayName', '::'+name);
    }

    klass = constructor;

    $defineProperty(klass, '$$name', name);
    $defineProperty(klass, '$$constructor', constructor);
    $defineProperty(klass, '$$prototype', constructor.prototype);
    $defineProperty(klass, '$$const', {});
    $defineProperty(klass, '$$is_class', true);
    $defineProperty(klass, '$$is_a_module', true);
    $defineProperty(klass, '$$super', superclass);
    $defineProperty(klass, '$$cvars', {});
    $defineProperty(klass, '$$own_included_modules', []);
    $defineProperty(klass, '$$own_prepended_modules', []);
    $defineProperty(klass, '$$ancestors', []);
    $defineProperty(klass, '$$ancestors_cache_version', null);

    $defineProperty(klass.$$prototype, '$$class', klass);

    // By default if there are no singleton class methods
    // __proto__ is Class.prototype
    // Later singleton methods generate a singleton_class
    // and inject it into ancestors chain
    if (Opal.Class) {
      $setPrototype(klass, Opal.Class.prototype);
    }

    if (superclass != null) {
      $setPrototype(klass.$$prototype, superclass.$$prototype);

      if (superclass.$$meta) {
        // If superclass has metaclass then we have explicitely inherit it.
        Opal.build_class_singleton_class(klass);
      }
    }

    return klass;
  };


  function find_existing_class(scope, name) {
    // Try to find the class in the current scope
    var klass = const_get_name(scope, name);

    // If the class exists in the scope, then we must use that
    if (klass) {
      // Make sure the existing constant is a class, or raise error
      if (!klass.$$is_class) {
        throw Opal.TypeError.$new(name + " is not a class");
      }

      return klass;
    }
  }

  function ensureSuperclassMatch(klass, superclass) {
    if (klass.$$super !== superclass) {
      throw Opal.TypeError.$new("superclass mismatch for class " + klass.$$name);
    }
  }

  Opal.klass = function(scope, superclass, name) {
    var bridged;

    if (scope == null) {
      // Global scope
      scope = _Object;
    } else if (!scope.$$is_class && !scope.$$is_module) {
      // Scope is an object, use its class
      scope = scope.$$class;
    }

    // If the superclass is not an Opal-generated class then we're bridging a native JS class
    if (superclass != null && !superclass.hasOwnProperty('$$is_class')) {
      bridged = superclass;
      superclass = _Object;
    }

    var klass = find_existing_class(scope, name);

    if (klass) {
      if (superclass) {
        // Make sure existing class has same superclass
        ensureSuperclassMatch(klass, superclass);
      }
      return klass;
    }

    // Class doesn't exist, create a new one with given superclass...

    // Not specifying a superclass means we can assume it to be Object
    if (superclass == null) {
      superclass = _Object;
    }

    // Create the class object (instance of Class)
    klass = Opal.allocate_class(name, superclass);
    Opal.const_set(scope, name, klass);

    // Call .inherited() hook with new class on the superclass
    if (superclass.$inherited) {
      superclass.$inherited(klass);
    }

    if (bridged) {
      Opal.bridge(bridged, klass);
    }

    return klass;
  };

  // Define new module (or return existing module). The given `scope` is basically
  // the current `self` value the `module` statement was defined in. If this is
  // a ruby module or class, then it is used, otherwise if the scope is a ruby
  // object then that objects real ruby class is used (e.g. if the scope is the
  // main object, then the top level `Object` class is used as the scope).
  //
  // If a module of the given name is already defined in the scope, then that
  // instance is just returned.
  //
  // If there is a class of the given name in the scope, then an error is
  // generated instead (cannot have a class and module of same name in same scope).
  //
  // Otherwise, a new module is created in the scope with the given name, and that
  // new instance is returned back (to be referenced at runtime).
  //
  // @param  scope [Module, Class] class or module this definition is inside
  // @param  id   [String] the name of the new (or existing) module
  //
  // @return [Module]
  Opal.allocate_module = function(name) {
    var constructor = function(){};
    if (name) {
      $defineProperty(constructor, 'displayName', name+'.$$constructor');
    }

    var module = constructor;

    if (name)
      $defineProperty(constructor, 'displayName', name+'.constructor');

    $defineProperty(module, '$$name', name);
    $defineProperty(module, '$$prototype', constructor.prototype);
    $defineProperty(module, '$$const', {});
    $defineProperty(module, '$$is_module', true);
    $defineProperty(module, '$$is_a_module', true);
    $defineProperty(module, '$$cvars', {});
    $defineProperty(module, '$$iclasses', []);
    $defineProperty(module, '$$own_included_modules', []);
    $defineProperty(module, '$$own_prepended_modules', []);
    $defineProperty(module, '$$ancestors', [module]);
    $defineProperty(module, '$$ancestors_cache_version', null);

    $setPrototype(module, Opal.Module.prototype);

    return module;
  };

  function find_existing_module(scope, name) {
    var module = const_get_name(scope, name);
    if (module == null && scope === _Object) module = const_lookup_ancestors(_Object, name);

    if (module) {
      if (!module.$$is_module && module !== _Object) {
        throw Opal.TypeError.$new(name + " is not a module");
      }
    }

    return module;
  }

  Opal.module = function(scope, name) {
    var module;

    if (scope == null) {
      // Global scope
      scope = _Object;
    } else if (!scope.$$is_class && !scope.$$is_module) {
      // Scope is an object, use its class
      scope = scope.$$class;
    }

    module = find_existing_module(scope, name);

    if (module) {
      return module;
    }

    // Module doesnt exist, create a new one...
    module = Opal.allocate_module(name);
    Opal.const_set(scope, name, module);

    return module;
  };

  // Return the singleton class for the passed object.
  //
  // If the given object alredy has a singleton class, then it will be stored on
  // the object as the `$$meta` property. If this exists, then it is simply
  // returned back.
  //
  // Otherwise, a new singleton object for the class or object is created, set on
  // the object at `$$meta` for future use, and then returned.
  //
  // @param object [Object] the ruby object
  // @return [Class] the singleton class for object
  Opal.get_singleton_class = function(object) {
    if (object.$$meta) {
      return object.$$meta;
    }

    if (object.hasOwnProperty('$$is_class')) {
      return Opal.build_class_singleton_class(object);
    } else if (object.hasOwnProperty('$$is_module')) {
      return Opal.build_module_singletin_class(object);
    } else {
      return Opal.build_object_singleton_class(object);
    }
  };

  // Build the singleton class for an existing class. Class object are built
  // with their singleton class already in the prototype chain and inheriting
  // from their superclass object (up to `Class` itself).
  //
  // NOTE: Actually in MRI a class' singleton class inherits from its
  // superclass' singleton class which in turn inherits from Class.
  //
  // @param klass [Class]
  // @return [Class]
  Opal.build_class_singleton_class = function(klass) {
    var superclass, meta;

    if (klass.$$meta) {
      return klass.$$meta;
    }

    // The singleton_class superclass is the singleton_class of its superclass;
    // but BasicObject has no superclass (its `$$super` is null), thus we
    // fallback on `Class`.
    superclass = klass === BasicObject ? Class : Opal.get_singleton_class(klass.$$super);

    meta = Opal.allocate_class(null, superclass, function(){});

    $defineProperty(meta, '$$is_singleton', true);
    $defineProperty(meta, '$$singleton_of', klass);
    $defineProperty(klass, '$$meta', meta);
    $setPrototype(klass, meta.$$prototype);
    // Restoring ClassName.class
    $defineProperty(klass, '$$class', Opal.Class);

    return meta;
  };

  Opal.build_module_singletin_class = function(mod) {
    if (mod.$$meta) {
      return mod.$$meta;
    }

    var meta = Opal.allocate_class(null, Opal.Module, function(){});

    $defineProperty(meta, '$$is_singleton', true);
    $defineProperty(meta, '$$singleton_of', mod);
    $defineProperty(mod, '$$meta', meta);
    $setPrototype(mod, meta.$$prototype);
    // Restoring ModuleName.class
    $defineProperty(mod, '$$class', Opal.Module);

    return meta;
  };

  // Build the singleton class for a Ruby (non class) Object.
  //
  // @param object [Object]
  // @return [Class]
  Opal.build_object_singleton_class = function(object) {
    var superclass = object.$$class,
        klass = Opal.allocate_class(nil, superclass, function(){});

    $defineProperty(klass, '$$is_singleton', true);
    $defineProperty(klass, '$$singleton_of', object);

    delete klass.$$prototype.$$class;

    $defineProperty(object, '$$meta', klass);

    $setPrototype(object, object.$$meta.$$prototype);

    return klass;
  };

  Opal.is_method = function(prop) {
    return (prop[0] === '$' && prop[1] !== '$');
  };

  Opal.instance_methods = function(mod) {
    var exclude = [], results = [], ancestors = Opal.ancestors(mod);

    for (var i = 0, l = ancestors.length; i < l; i++) {
      var ancestor = ancestors[i],
          proto = ancestor.$$prototype;

      if (proto.hasOwnProperty('$$dummy')) {
        proto = proto.$$define_methods_on;
      }

      var props = Object.getOwnPropertyNames(proto);

      for (var j = 0, ll = props.length; j < ll; j++) {
        var prop = props[j];

        if (Opal.is_method(prop)) {
          var method_name = prop.slice(1),
              method = proto[prop];

          if (method.$$stub && exclude.indexOf(method_name) === -1) {
            exclude.push(method_name);
          }

          if (!method.$$stub && results.indexOf(method_name) === -1 && exclude.indexOf(method_name) === -1) {
            results.push(method_name);
          }
        }
      }
    }

    return results;
  };

  ;

  Opal.methods = function(obj) {
    return Opal.instance_methods(Opal.get_singleton_class(obj));
  };

  ;

  ;

  // Returns an object containing all pairs of names/values
  // for all class variables defined in provided +module+
  // and its ancestors.
  //
  // @param module [Module]
  // @return [Object]
  Opal.class_variables = function(module) {
    var ancestors = Opal.ancestors(module),
        i, length = ancestors.length,
        result = {};

    for (i = length - 1; i >= 0; i--) {
      var ancestor = ancestors[i];

      for (var cvar in ancestor.$$cvars) {
        result[cvar] = ancestor.$$cvars[cvar];
      }
    }

    return result;
  };

  // Sets class variable with specified +name+ to +value+
  // in provided +module+
  //
  // @param module [Module]
  // @param name [String]
  // @param value [Object]
  ;

  function isRoot(proto) {
    return proto.hasOwnProperty('$$iclass') && proto.hasOwnProperty('$$root');
  }

  function own_included_modules(module) {
    var result = [], mod, proto = Object.getPrototypeOf(module.$$prototype);

    while (proto) {
      if (proto.hasOwnProperty('$$class')) {
        // superclass
        break;
      }
      mod = protoToModule(proto);
      if (mod) {
        result.push(mod);
      }
      proto = Object.getPrototypeOf(proto);
    }

    return result;
  }

 


  // The actual inclusion of a module into a class.
  //
  // ## Class `$$parent` and `iclass`
  //
  // To handle `super` calls, every class has a `$$parent`. This parent is
  // used to resolve the next class for a super call. A normal class would
  // have this point to its superclass. However, if a class includes a module
  // then this would need to take into account the module. The module would
  // also have to then point its `$$parent` to the actual superclass. We
  // cannot modify modules like this, because it might be included in more
  // then one class. To fix this, we actually insert an `iclass` as the class'
  // `$$parent` which can then point to the superclass. The `iclass` acts as
  // a proxy to the actual module, so the `super` chain can then search it for
  // the required method.
  //
  // @param module [Module] the module to include
  // @param includer [Module] the target class to include module into
  // @return [null]
  Opal.append_features = function(module, includer) {
    var module_ancestors = Opal.ancestors(module);
    var iclasses = [];

    if (module_ancestors.indexOf(includer) !== -1) {
      throw Opal.ArgumentError.$new('cyclic include detected');
    }

    for (var i = 0, length = module_ancestors.length; i < length; i++) {
      var ancestor = module_ancestors[i], iclass = create_iclass(ancestor);
      $defineProperty(iclass, '$$included', true);
      iclasses.push(iclass);
    }
    var includer_ancestors = Opal.ancestors(includer),
        chain = chain_iclasses(iclasses),
        start_chain_after,
        end_chain_on;

    if (includer_ancestors.indexOf(module) === -1) {
      // first time include

      // includer -> chain.first -> ...chain... -> chain.last -> includer.parent
      start_chain_after = includer.$$prototype;
      end_chain_on = Object.getPrototypeOf(includer.$$prototype);
    } else {
      // The module has been already included,
      // we don't need to put it into the ancestors chain again,
      // but this module may have new included modules.
      // If it's true we need to copy them.
      //
      // The simplest way is to replace ancestors chain from
      //          parent
      //            |
      //   `module` iclass (has a $$root flag)
      //            |
      //   ...previos chain of module.included_modules ...
      //            |
      //  "next ancestor" (has a $$root flag or is a real class)
      //
      // to
      //          parent
      //            |
      //    `module` iclass (has a $$root flag)
      //            |
      //   ...regenerated chain of module.included_modules
      //            |
      //   "next ancestor" (has a $$root flag or is a real class)
      //
      // because there are no intermediate classes between `parent` and `next ancestor`.
      // It doesn't break any prototypes of other objects as we don't change class references.

      var proto = includer.$$prototype, parent = proto, module_iclass = Object.getPrototypeOf(parent);

      while (module_iclass != null) {
        if (isRoot(module_iclass) && module_iclass.$$module === module) {
          break;
        }

        parent = module_iclass;
        module_iclass = Object.getPrototypeOf(module_iclass);
      }

      var next_ancestor = Object.getPrototypeOf(module_iclass);

      // skip non-root iclasses (that were recursively included)
      while (next_ancestor.hasOwnProperty('$$iclass') && !isRoot(next_ancestor)) {
        next_ancestor = Object.getPrototypeOf(next_ancestor);
      }

      start_chain_after = parent;
      end_chain_on = next_ancestor;
    }

    $setPrototype(start_chain_after, chain.first);
    $setPrototype(chain.last, end_chain_on);

    // recalculate own_included_modules cache
    includer.$$own_included_modules = own_included_modules(includer);

    Opal.const_cache_version++;
  };

  ;

 

  function create_iclass(module) {
    var iclass = create_dummy_iclass(module);

    if (module.$$is_module) {
      module.$$iclasses.push(iclass);
    }

    return iclass;
  }

  // Dummy iclass doesn't receive updates when the module gets a new method.
  function create_dummy_iclass(module) {
    var iclass = {},
        proto = module.$$prototype;

    if (proto.hasOwnProperty('$$dummy')) {
      proto = proto.$$define_methods_on;
    }

    var props = Object.getOwnPropertyNames(proto),
        length = props.length, i;

    for (i = 0; i < length; i++) {
      var prop = props[i];
      $defineProperty(iclass, prop, proto[prop]);
    }

    $defineProperty(iclass, '$$iclass', true);
    $defineProperty(iclass, '$$module', module);

    return iclass;
  }

  function chain_iclasses(iclasses) {
    var length = iclasses.length, first = iclasses[0];

    $defineProperty(first, '$$root', true);

    if (length === 1) {
      return { first: first, last: first };
    }

    var previous = first;

    for (var i = 1; i < length; i++) {
      var current = iclasses[i];
      $setPrototype(previous, current);
      previous = current;
    }


    return { first: iclasses[0], last: iclasses[length - 1] };
  }

  // For performance, some core Ruby classes are toll-free bridged to their
  // native JavaScript counterparts (e.g. a Ruby Array is a JavaScript Array).
  //
  // This method is used to setup a native constructor (e.g. Array), to have
  // its prototype act like a normal Ruby class. Firstly, a new Ruby class is
  // created using the native constructor so that its prototype is set as the
  // target for the new class. Note: all bridged classes are set to inherit
  // from Object.
  //
  // Example:
  //
  //    Opal.bridge(self, Function);
  //
  // @param klass       [Class] the Ruby class to bridge
  // @param constructor [JS.Function] native JavaScript constructor to use
  // @return [Class] returns the passed Ruby class
  //
  Opal.bridge = function(native_klass, klass) {
    if (native_klass.hasOwnProperty('$$bridge')) {
      throw Opal.ArgumentError.$new("already bridged");
    }

    var klass_to_inject, klass_reference;

    klass_to_inject = klass.$$super || Opal.Object;
    klass_reference = klass;
    var original_prototype = klass.$$prototype;

    // constructor is a JS function with a prototype chain like:
    // - constructor
    //   - super
    //
    // What we need to do is to inject our class (with its prototype chain)
    // between constructor and super. For example, after injecting ::Object
    // into JS String we get:
    //
    // - constructor (window.String)
    //   - Opal.Object
    //     - Opal.Kernel
    //       - Opal.BasicObject
    //         - super (window.Object)
    //           - null
    //
    $defineProperty(native_klass, '$$bridge', klass);
    $setPrototype(native_klass.prototype, (klass.$$super || Opal.Object).$$prototype);
    $defineProperty(klass, '$$prototype', native_klass.prototype);

    $defineProperty(klass.$$prototype, '$$class', klass);
    $defineProperty(klass, '$$constructor', native_klass);
    $defineProperty(klass, '$$bridge', true);
  };

  function protoToModule(proto) {
    if (proto.hasOwnProperty('$$dummy')) {
      return;
    } else if (proto.hasOwnProperty('$$iclass')) {
      return proto.$$module;
    } else if (proto.hasOwnProperty('$$class')) {
      return proto.$$class;
    }
  }

  function own_ancestors(module) {
    return module.$$own_prepended_modules.concat([module]).concat(module.$$own_included_modules);
  }

  // The Array of ancestors for a given module/class
  Opal.ancestors = function(module) {
    if (!module) { return []; }

    if (module.$$ancestors_cache_version === Opal.const_cache_version) {
      return module.$$ancestors;
    }

    var result = [], i, mods, length;

    for (i = 0, mods = own_ancestors(module), length = mods.length; i < length; i++) {
      result.push(mods[i]);
    }

    if (module.$$super) {
      for (i = 0, mods = Opal.ancestors(module.$$super), length = mods.length; i < length; i++) {
        result.push(mods[i]);
      }
    }

    module.$$ancestors_cache_version = Opal.const_cache_version;
    module.$$ancestors = result;

    return result;
  };

  Opal.included_modules = function(module) {
    var result = [], mod = null, proto = Object.getPrototypeOf(module.$$prototype);

    for (; proto && Object.getPrototypeOf(proto); proto = Object.getPrototypeOf(proto)) {
      mod = protoToModule(proto);
      if (mod && mod.$$is_module && proto.$$iclass && proto.$$included) {
        result.push(mod);
      }
    }

    return result;
  };


  // Method Missing
  // --------------

  // Methods stubs are used to facilitate method_missing in opal. A stub is a
  // placeholder function which just calls `method_missing` on the receiver.
  // If no method with the given name is actually defined on an object, then it
  // is obvious to say that the stub will be called instead, and then in turn
  // method_missing will be called.
  //
  // When a file in ruby gets compiled to javascript, it includes a call to
  // this function which adds stubs for every method name in the compiled file.
  // It should then be safe to assume that method_missing will work for any
  // method call detected.
  //
  // Method stubs are added to the BasicObject prototype, which every other
  // ruby object inherits, so all objects should handle method missing. A stub
  // is only added if the given property name (method name) is not already
  // defined.
  //
  // Note: all ruby methods have a `$` prefix in javascript, so all stubs will
  // have this prefix as well (to make this method more performant).
  //
  //
  // All stub functions will have a private `$$stub` property set to true so
  // that other internal methods can detect if a method is just a stub or not.
  // `Kernel#respond_to?` uses this property to detect a methods presence.
  //
  // @param stubs [Array] an array of method stubs to add
  // @return [undefined]
  ;

  // Add a method_missing stub function to the given prototype for the
  // given name.
  //
  // @param prototype [Prototype] the target prototype
  // @param stub [String] stub name to add (e.g. "$foo")
  // @return [undefined]
  ;

  // Generate the method_missing stub for a given method name.
  //
  // @param method_name [String] The js-name of the method to stub (e.g. "$foo")
  // @return [undefined]
  ;


  // Methods
  // -------

  // Arity count error dispatcher for methods
  //
  // @param actual [Fixnum] number of arguments given to method
  // @param expected [Fixnum] expected number of arguments
  // @param object [Object] owner of the method +meth+
  // @param meth [String] method name that got wrong number of arguments
  // @raise [ArgumentError]
  Opal.ac = function(actual, expected, object, meth) {
    var inspect = '';
    if (object.$$is_a_module) {
      inspect += object.$$name + '.';
    }
    else {
      inspect += object.$$class.$$name + '#';
    }
    inspect += meth;

    throw Opal.ArgumentError.$new('[' + inspect + '] wrong number of arguments(' + actual + ' for ' + expected + ')');
  };

  // Arity count error dispatcher for blocks
  //
  // @param actual [Fixnum] number of arguments given to block
  // @param expected [Fixnum] expected number of arguments
  // @param context [Object] context of the block definition
  // @raise [ArgumentError]
  ;

  // Super dispatcher
  Opal.find_super_dispatcher = function(obj, mid, current_func, defcheck, defs) {
    var jsid = '$' + mid, ancestors, super_method;

    if (obj.hasOwnProperty('$$meta')) {
      ancestors = Opal.ancestors(obj.$$meta);
    } else {
      ancestors = Opal.ancestors(obj.$$class);
    }

    var current_index = ancestors.indexOf(current_func.$$owner);

    for (var i = current_index + 1; i < ancestors.length; i++) {
      var ancestor = ancestors[i],
          proto = ancestor.$$prototype;

      if (proto.hasOwnProperty('$$dummy')) {
        proto = proto.$$define_methods_on;
      }

      if (proto.hasOwnProperty(jsid)) {
        var method = proto[jsid];

        if (!method.$$stub) {
          super_method = method;
        }
        break;
      }
    }

    if (!defcheck && super_method == null && Opal.Kernel.$method_missing === obj.$method_missing) {
      // method_missing hasn't been explicitly defined
      throw Opal.NoMethodError.$new('super: no superclass method `'+mid+"' for "+obj, mid);
    }

    return super_method;
  };

  // Iter dispatcher for super in a block
  ;

  // Used to return as an expression. Sometimes, we can't simply return from
  // a javascript function as if we were a method, as the return is used as
  // an expression, or even inside a block which must "return" to the outer
  // method. This helper simply throws an error which is then caught by the
  // method. This approach is expensive, so it is only used when absolutely
  // needed.
  //
  Opal.ret = function(val) {
    Opal.returner.$v = val;
    throw Opal.returner;
  };

  // Used to break out of a block.
  Opal.brk = function(val, breaker) {
    breaker.$v = val;
    throw breaker;
  };

  // Builds a new unique breaker, this is to avoid multiple nested breaks to get
  // in the way of each other.
  ;

  // handles yield calls for 1 yielded arg
  Opal.yield1 = function(block, arg) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    var has_mlhs = block.$$has_top_level_mlhs_arg,
        has_trailing_comma = block.$$has_trailing_comma_in_args;

    if (block.length > 1 || ((has_mlhs || has_trailing_comma) && block.length === 1)) {
      arg = Opal.to_ary(arg);
    }

    if ((block.length > 1 || (has_trailing_comma && block.length === 1)) && arg.$$is_array) {
      return block.apply(null, arg);
    }
    else {
      return block(arg);
    }
  };

  // handles yield for > 1 yielded arg
  Opal.yieldX = function(block, args) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    if (block.length > 1 && args.length === 1) {
      if (args[0].$$is_array) {
        return block.apply(null, args[0]);
      }
    }

    if (!args.$$is_array) {
      var args_ary = new Array(args.length);
      for(var i = 0, l = args_ary.length; i < l; i++) { args_ary[i] = args[i]; }

      return block.apply(null, args_ary);
    }

    return block.apply(null, args);
  };

  // Finds the corresponding exception match in candidates.  Each candidate can
  // be a value, or an array of values.  Returns null if not found.
  Opal.rescue = function(exception, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];

      if (candidate.$$is_array) {
        var result = Opal.rescue(exception, candidate);

        if (result) {
          return result;
        }
      }
      else if (candidate === Opal.JS.Error) {
        return candidate;
      }
      else if (candidate['$==='](exception)) {
        return candidate;
      }
    }

    return null;
  };

  Opal.is_a = function(object, klass) {
    if (klass != null && object.$$meta === klass || object.$$class === klass) {
      return true;
    }

    if (object.$$is_number && klass.$$is_number_class) {
      return true;
    }

    var i, length, ancestors = Opal.ancestors(object.$$is_class ? Opal.get_singleton_class(object) : (object.$$meta || object.$$class));

    for (i = 0, length = ancestors.length; i < length; i++) {
      if (ancestors[i] === klass) {
        return true;
      }
    }

    return false;
  };

  // Helpers for extracting kwsplats
  // Used for: { **h }
  Opal.to_hash = function(value) {
    if (value.$$is_hash) {
      return value;
    }
    else if (value['$respond_to?']('to_hash', true)) {
      var hash = value.$to_hash();
      if (hash.$$is_hash) {
        return hash;
      }
      else {
        throw Opal.TypeError.$new("Can't convert " + value.$$class +
          " to Hash (" + value.$$class + "#to_hash gives " + hash.$$class + ")");
      }
    }
    else {
      throw Opal.TypeError.$new("no implicit conversion of " + value.$$class + " into Hash");
    }
  };

  // Helpers for implementing multiple assignment
  // Our code for extracting the values and assigning them only works if the
  // return value is a JS array.
  // So if we get an Array subclass, extract the wrapped JS array from it

  // Used for: a, b = something (no splat)
  Opal.to_ary = function(value) {
    if (value.$$is_array) {
      return value;
    }
    else if (value['$respond_to?']('to_ary', true)) {
      var ary = value.$to_ary();
      if (ary === nil) {
        return [value];
      }
      else if (ary.$$is_array) {
        return ary;
      }
      else {
        throw Opal.TypeError.$new("Can't convert " + value.$$class +
          " to Array (" + value.$$class + "#to_ary gives " + ary.$$class + ")");
      }
    }
    else {
      return [value];
    }
  };

  // Used for: a, b = *something (with splat)
  Opal.to_a = function(value) {
    if (value.$$is_array) {
      // A splatted array must be copied
      return value.slice();
    }
    else if (value['$respond_to?']('to_a', true)) {
      var ary = value.$to_a();
      if (ary === nil) {
        return [value];
      }
      else if (ary.$$is_array) {
        return ary;
      }
      else {
        throw Opal.TypeError.$new("Can't convert " + value.$$class +
          " to Array (" + value.$$class + "#to_a gives " + ary.$$class + ")");
      }
    }
    else {
      return [value];
    }
  };

  // Used for extracting keyword arguments from arguments passed to
  // JS function. If provided +arguments+ list doesn't have a Hash
  // as a last item, returns a blank Hash.
  //
  // @param parameters [Array]
  // @return [Hash]
  //
  Opal.extract_kwargs = function(parameters) {
    var kwargs = parameters[parameters.length - 1];
    if (kwargs != null && kwargs['$respond_to?']('to_hash', true)) {
      $splice.call(parameters, parameters.length - 1, 1);
      return kwargs.$to_hash();
    }
    else {
      return Opal.hash2([], {});
    }
  };

  // Used to get a list of rest keyword arguments. Method takes the given
  // keyword args, i.e. the hash literal passed to the method containing all
  // keyword arguemnts passed to method, as well as the used args which are
  // the names of required and optional arguments defined. This method then
  // just returns all key/value pairs which have not been used, in a new
  // hash literal.
  //
  // @param given_args [Hash] all kwargs given to method
  // @param used_args [Object<String: true>] all keys used as named kwargs
  // @return [Hash]
  //
  ;

  // Calls passed method on a ruby object with arguments and block:
  //
  // Can take a method or a method name.
  //
  // 1. When method name gets passed it invokes it by its name
  //    and calls 'method_missing' when object doesn't have this method.
  //    Used internally by Opal to invoke method that takes a block or a splat.
  // 2. When method (i.e. method body) gets passed, it doesn't trigger 'method_missing'
  //    because it doesn't know the name of the actual method.
  //    Used internally by Opal to invoke 'super'.
  //
  // @example
  //   var my_array = [1, 2, 3, 4]
  //   Opal.send(my_array, 'length')                    # => 4
  //   Opal.send(my_array, my_array.$length)            # => 4
  //
  //   Opal.send(my_array, 'reverse!')                  # => [4, 3, 2, 1]
  //   Opal.send(my_array, my_array['$reverse!']')      # => [4, 3, 2, 1]
  //
  // @param recv [Object] ruby object
  // @param method [Function, String] method body or name of the method
  // @param args [Array] arguments that will be passed to the method call
  // @param block [Function] ruby block
  // @return [Object] returning value of the method call
  Opal.send = function(recv, method, args, block) {
    var body = (typeof(method) === 'string') ? recv['$'+method] : method;

    if (body != null) {
      if (typeof block === 'function') {
        body.$$p = block;
      }
      return body.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [method].concat(args));
  };

  Opal.lambda = function(block) {
    block.$$is_lambda = true;
    return block;
  };

  // Used to define methods on an object. This is a helper method, used by the
  // compiled source to define methods on special case objects when the compiler
  // can not determine the destination object, or the object is a Module
  // instance. This can get called by `Module#define_method` as well.
  //
  // ## Modules
  //
  // Any method defined on a module will come through this runtime helper.
  // The method is added to the module body, and the owner of the method is
  // set to be the module itself. This is used later when choosing which
  // method should show on a class if more than 1 included modules define
  // the same method. Finally, if the module is in `module_function` mode,
  // then the method is also defined onto the module itself.
  //
  // ## Classes
  //
  // This helper will only be called for classes when a method is being
  // defined indirectly; either through `Module#define_method`, or by a
  // literal `def` method inside an `instance_eval` or `class_eval` body. In
  // either case, the method is simply added to the class' prototype. A special
  // exception exists for `BasicObject` and `Object`. These two classes are
  // special because they are used in toll-free bridged classes. In each of
  // these two cases, extra work is required to define the methods on toll-free
  // bridged class' prototypes as well.
  //
  // ## Objects
  //
  // If a simple ruby object is the object, then the method is simply just
  // defined on the object as a singleton method. This would be the case when
  // a method is defined inside an `instance_eval` block.
  //
  // @param obj  [Object, Class] the actual obj to define method for
  // @param jsid [String] the JavaScript friendly method name (e.g. '$foo')
  // @param body [JS.Function] the literal JavaScript function used as method
  // @return [null]
  //
  Opal.def = function(obj, jsid, body) {
    // Special case for a method definition in the
    // top-level namespace
    if (obj === Opal.top) {
      Opal.defn(Opal.Object, jsid, body)
    }
    // if instance_eval is invoked on a module/class, it sets inst_eval_mod
    else if (!obj.$$eval && obj.$$is_a_module) {
      Opal.defn(obj, jsid, body);
    }
    else {
      Opal.defs(obj, jsid, body);
    }
  };

  // Define method on a module or class (see Opal.def).
  Opal.defn = function(module, jsid, body) {
    body.displayName = jsid;
    body.$$owner = module;

    var proto = module.$$prototype;
    if (proto.hasOwnProperty('$$dummy')) {
      proto = proto.$$define_methods_on;
    }
    $defineProperty(proto, jsid, body);

    if (module.$$is_module) {
      if (module.$$module_function) {
        Opal.defs(module, jsid, body)
      }

      for (var i = 0, iclasses = module.$$iclasses, length = iclasses.length; i < length; i++) {
        var iclass = iclasses[i];
        $defineProperty(iclass, jsid, body);
      }
    }

    var singleton_of = module.$$singleton_of;
    if (module.$method_added && !module.$method_added.$$stub && !singleton_of) {
      module.$method_added(jsid.substr(1));
    }
    else if (singleton_of && singleton_of.$singleton_method_added && !singleton_of.$singleton_method_added.$$stub) {
      singleton_of.$singleton_method_added(jsid.substr(1));
    }
  };

  // Define a singleton method on the given object (see Opal.def).
  Opal.defs = function(obj, jsid, body) {
    if (obj.$$is_string || obj.$$is_number) {
      throw Opal.TypeError.$new("can't define singleton");
    }
    Opal.defn(Opal.get_singleton_class(obj), jsid, body)
  };

  // Called from #remove_method.
  ;

  // Called from #undef_method.
  Opal.udef = function(obj, jsid) {
    if (!obj.$$prototype[jsid] || obj.$$prototype[jsid].$$stub) {
      throw Opal.NameError.$new("method '" + jsid.substr(1) + "' not defined in " + obj.$name());
    }


    if (obj.$$is_singleton) {
      if (obj.$$prototype.$singleton_method_undefined && !obj.$$prototype.$singleton_method_undefined.$$stub) {
        obj.$$prototype.$singleton_method_undefined(jsid.substr(1));
      }
    }
    else {
      if (obj.$method_undefined && !obj.$method_undefined.$$stub) {
        obj.$method_undefined(jsid.substr(1));
      }
    }
  };

  function is_method_body(body) {
    return (typeof(body) === "function" && !body.$$stub);
  }

  Opal.alias = function(obj, name, old) {
    var id     = '$' + name,
        old_id = '$' + old,
        body   = obj.$$prototype['$' + old],
        alias;

    // When running inside #instance_eval the alias refers to class methods.
    if (obj.$$eval) {
      return Opal.alias(Opal.get_singleton_class(obj), name, old);
    }

    if (!is_method_body(body)) {
      var ancestor = obj.$$super;

      while (typeof(body) !== "function" && ancestor) {
        body     = ancestor[old_id];
        ancestor = ancestor.$$super;
      }

      if (!is_method_body(body) && obj.$$is_module) {
        // try to look into Object
        body = Opal.Object.$$prototype[old_id]
      }

      if (!is_method_body(body)) {
        throw Opal.NameError.$new("undefined method `" + old + "' for class `" + obj.$name() + "'")
      }
    }

    // If the body is itself an alias use the original body
    // to keep the max depth at 1.
    if (body.$$alias_of) body = body.$$alias_of;

    // We need a wrapper because otherwise properties
    // would be overwritten on the original body.
    alias = function() {
      var block = alias.$$p, args, i, ii;

      args = new Array(arguments.length);
      for(i = 0, ii = arguments.length; i < ii; i++) {
        args[i] = arguments[i];
      }

      if (block != null) { alias.$$p = null }

      return Opal.send(this, body, args, block);
    };

    // Assign the 'length' value with defineProperty because
    // in strict mode the property is not writable.
    Object.defineProperty(alias, 'length', { value: body.length });

    // Try to make the browser pick the right name
    alias.displayName       = name;

    alias.$$arity           = body.$$arity;
    alias.$$parameters      = body.$$parameters;
    alias.$$source_location = body.$$source_location;
    alias.$$alias_of        = body;
    alias.$$alias_name      = name;

    Opal.defn(obj, id, alias);

    return obj;
  };

  ;


  // Hashes
  // ------

  Opal.hash_init = function(hash) {
    hash.$$smap = Object.create(null);
    hash.$$map  = Object.create(null);
    hash.$$keys = [];
  };

  Opal.hash_clone = function(from_hash, to_hash) {
    to_hash.$$none = from_hash.$$none;
    to_hash.$$proc = from_hash.$$proc;

    for (var i = 0, keys = from_hash.$$keys, smap = from_hash.$$smap, len = keys.length, key, value; i < len; i++) {
      key = keys[i];

      if (key.$$is_string) {
        value = smap[key];
      } else {
        value = key.value;
        key = key.key;
      }

      Opal.hash_put(to_hash, key, value);
    }
  };

  Opal.hash_put = function(hash, key, value) {
    if (key.$$is_string) {
      if (!$hasOwn.call(hash.$$smap, key)) {
        hash.$$keys.push(key);
      }
      hash.$$smap[key] = value;
      return;
    }

    var key_hash, bucket, last_bucket;
    key_hash = hash.$$by_identity ? Opal.id(key) : key.$hash();

    if (!$hasOwn.call(hash.$$map, key_hash)) {
      bucket = {key: key, key_hash: key_hash, value: value};
      hash.$$keys.push(bucket);
      hash.$$map[key_hash] = bucket;
      return;
    }

    bucket = hash.$$map[key_hash];

    while (bucket) {
      if (key === bucket.key || key['$eql?'](bucket.key)) {
        last_bucket = undefined;
        bucket.value = value;
        break;
      }
      last_bucket = bucket;
      bucket = bucket.next;
    }

    if (last_bucket) {
      bucket = {key: key, key_hash: key_hash, value: value};
      hash.$$keys.push(bucket);
      last_bucket.next = bucket;
    }
  };

  Opal.hash_get = function(hash, key) {
    if (key.$$is_string) {
      if ($hasOwn.call(hash.$$smap, key)) {
        return hash.$$smap[key];
      }
      return;
    }

    var key_hash, bucket;
    key_hash = hash.$$by_identity ? Opal.id(key) : key.$hash();

    if ($hasOwn.call(hash.$$map, key_hash)) {
      bucket = hash.$$map[key_hash];

      while (bucket) {
        if (key === bucket.key || key['$eql?'](bucket.key)) {
          return bucket.value;
        }
        bucket = bucket.next;
      }
    }
  };

  ;

  ;

  Opal.hash = function() {
    var arguments_length = arguments.length, args, hash, i, length, key, value;

    if (arguments_length === 1 && arguments[0].$$is_hash) {
      return arguments[0];
    }

    hash = new Opal.Hash();
    Opal.hash_init(hash);

    if (arguments_length === 1 && arguments[0].$$is_array) {
      args = arguments[0];
      length = args.length;

      for (i = 0; i < length; i++) {
        if (args[i].length !== 2) {
          throw Opal.ArgumentError.$new("value not of length 2: " + args[i].$inspect());
        }

        key = args[i][0];
        value = args[i][1];

        Opal.hash_put(hash, key, value);
      }

      return hash;
    }

    if (arguments_length === 1) {
      args = arguments[0];
      for (key in args) {
        if ($hasOwn.call(args, key)) {
          value = args[key];

          Opal.hash_put(hash, key, value);
        }
      }

      return hash;
    }

    if (arguments_length % 2 !== 0) {
      throw Opal.ArgumentError.$new("odd number of arguments for Hash");
    }

    for (i = 0; i < arguments_length; i += 2) {
      key = arguments[i];
      value = arguments[i + 1];

      Opal.hash_put(hash, key, value);
    }

    return hash;
  };

  // A faster Hash creator for hashes that just use symbols and
  // strings as keys. The map and keys array can be constructed at
  // compile time, so they are just added here by the constructor
  // function.
  //
  Opal.hash2 = function(keys, smap) {
    var hash = new Opal.Hash();

    hash.$$smap = smap;
    hash.$$map  = Object.create(null);
    hash.$$keys = keys;

    return hash;
  };

  // Create a new range instance with first and last values, and whether the
  // range excludes the last value.
  //
  Opal.range = function(first, last, exc) {
    var range         = new Opal.Range();
        range.begin   = first;
        range.end     = last;
        range.excl    = exc;

    return range;
  };

  // Get the ivar name for a given name.
  // Mostly adds a trailing $ to reserved names.
  //
  Opal.ivar = function(name) {
    if (
        // properties
        name === "constructor" ||
        name === "displayName" ||
        name === "__count__" ||
        name === "__noSuchMethod__" ||
        name === "__parent__" ||
        name === "__proto__" ||

        // methods
        name === "hasOwnProperty" ||
        name === "valueOf"
       )
    {
      return name + "$";
    }

    return name;
  };


  // Regexps
  // -------

  // Escape Regexp special chars letting the resulting string be used to build
  // a new Regexp.
  //
  ;

  // Create a global Regexp from a RegExp object and cache the result
  // on the object itself ($$g attribute).
  //
  Opal.global_regexp = function(pattern) {
    if (pattern.global) {
      return pattern; // RegExp already has the global flag
    }
    if (pattern.$$g == null) {
      pattern.$$g = new RegExp(pattern.source, (pattern.multiline ? 'gm' : 'g') + (pattern.ignoreCase ? 'i' : ''));
    } else {
      pattern.$$g.lastIndex = null; // reset lastIndex property
    }
    return pattern.$$g;
  };

  // Create a global multiline Regexp from a RegExp object and cache the result
  // on the object itself ($$gm or $$g attribute).
  //
  Opal.global_multiline_regexp = function(pattern) {
    var result;
    if (pattern.multiline) {
      if (pattern.global) {
        return pattern; // RegExp already has the global and multiline flag
      }
      // we are using the $$g attribute because the Regexp is already multiline
      if (pattern.$$g != null) {
        result = pattern.$$g;
      } else {
        result = pattern.$$g = new RegExp(pattern.source, 'gm' + (pattern.ignoreCase ? 'i' : ''));
      }
    } else if (pattern.$$gm != null) {
      result = pattern.$$gm;
    } else {
      result = pattern.$$gm = new RegExp(pattern.source, 'gm' + (pattern.ignoreCase ? 'i' : ''));
    }
    result.lastIndex = null; // reset lastIndex property
    return result;
  };

  // Require system
  // --------------

  Opal.modules         = {};
  Opal.loaded_features = ['corelib/runtime'];
  Opal.current_dir     = '.';
  Opal.require_table   = {'corelib/runtime': true};

  Opal.normalize = function(path) {
    var parts, part, new_parts = [], SEPARATOR = '/';

    if (Opal.current_dir !== '.') {
      path = Opal.current_dir.replace(/\/*$/, '/') + path;
    }

    path = path.replace(/^\.\//, '');
    path = path.replace(/\.(rb|opal|js)$/, '');
    parts = path.split(SEPARATOR);

    for (var i = 0, ii = parts.length; i < ii; i++) {
      part = parts[i];
      if (part === '') continue;
      (part === '..') ? new_parts.pop() : new_parts.push(part)
    }

    return new_parts.join(SEPARATOR);
  };

  Opal.loaded = function(paths) {
    var i, l, path;

    for (i = 0, l = paths.length; i < l; i++) {
      path = Opal.normalize(paths[i]);

      if (Opal.require_table[path]) {
        continue;
      }

      Opal.loaded_features.push(path);
      Opal.require_table[path] = true;
    }
  };

  Opal.load = function(path) {
    path = Opal.normalize(path);

    Opal.loaded([path]);

    var module = Opal.modules[path];

    if (module) {
      module(Opal);
    }
    else {
      var severity = Opal.config.missing_require_severity;
      var message  = 'cannot load such file -- ' + path;

      if (severity === "error") {
        if (Opal.LoadError) {
          throw Opal.LoadError.$new(message)
        } else {
          throw message
        }
      }
      else if (severity === "warning") {
        console.warn('WARNING: LoadError: ' + message);
      }
    }

    return true;
  };

  Opal.require = function(path) {
    path = Opal.normalize(path);

    if (Opal.require_table[path]) {
      return false;
    }

    return Opal.load(path);
  };


  // Strings
  // -------

  Opal.encodings = Object.create(null);

  // Sets the encoding on a string, will treat string literals as frozen strings
  // raising a FrozenError.
  // @param str [String] the string on which the encoding should be set.
  // @param name [String] the canonical name of the encoding
  Opal.set_encoding = function(str, name) {
    if (typeof str === 'string')
      throw Opal.FrozenError.$new("can't modify frozen String");

    var encoding = Opal.encodings[name];

    if (encoding === str.encoding) { return str; }

    str.encoding = encoding;

    return str;
  };

  // @returns a String object with the encoding set from a string literal
  


  // Initialization
  // --------------
  function $BasicObject() {}
  function $Object() {}
  function $Module() {}
  function $Class() {}

  Opal.BasicObject = BasicObject = Opal.allocate_class('BasicObject', null, $BasicObject);
  Opal.Object      = _Object     = Opal.allocate_class('Object', Opal.BasicObject, $Object);
  Opal.Module      = Module      = Opal.allocate_class('Module', Opal.Object, $Module);
  Opal.Class       = Class       = Opal.allocate_class('Class', Opal.Module, $Class);

  $setPrototype(Opal.BasicObject, Opal.Class.$$prototype);
  $setPrototype(Opal.Object, Opal.Class.$$prototype);
  $setPrototype(Opal.Module, Opal.Class.$$prototype);
  $setPrototype(Opal.Class, Opal.Class.$$prototype);

  // BasicObject can reach itself, avoid const_set to skip the $$base_module logic
  BasicObject.$$const["BasicObject"] = BasicObject;

  // Assign basic constants
  Opal.const_set(_Object, "BasicObject",  BasicObject);
  Opal.const_set(_Object, "Object",       _Object);
  Opal.const_set(_Object, "Module",       Module);
  Opal.const_set(_Object, "Class",        Class);

  // Fix booted classes to have correct .class value
  BasicObject.$$class = Class;
  _Object.$$class     = Class;
  Module.$$class      = Class;
  Class.$$class       = Class;

  // Forward .toString() to #to_s
  $defineProperty(_Object.$$prototype, 'toString', function() {
    var to_s = this.$to_s();
    if (to_s.$$is_string && typeof(to_s) === 'object') {
      // a string created using new String('string')
      return to_s.valueOf();
    } else {
      return to_s;
    }
  });

  // Make Kernel#require immediately available as it's needed to require all the
  // other corelib files.
  $defineProperty(_Object.$$prototype, '$require', Opal.require);

  // Instantiate the main object
  Opal.top = new _Object();
  Opal.top.$to_s = Opal.top.$inspect = function() { return 'main' };
  Opal.top.$define_method = top_define_method;

  // Foward calls to define_method on the top object to Object
  function top_define_method() {
    var args = Opal.slice.call(arguments, 0, arguments.length);
    var block = top_define_method.$$p;
    top_define_method.$$p = null;
    return Opal.send(_Object, 'define_method', args, block)
  };


  // Nil
  function $NilClass() {}
  Opal.NilClass = Opal.allocate_class('NilClass', Opal.Object, $NilClass);
  Opal.const_set(_Object, 'NilClass', Opal.NilClass);
  nil = Opal.nil = new Opal.NilClass();
  nil.$$id = nil_id;
  nil.call = nil.apply = function() { throw Opal.LocalJumpError.$new('no block given'); };

  // Errors
  Opal.breaker  = new Error('unexpected break (old)');
  Opal.returner = new Error('unexpected return');
  TypeError.$$super = Error;
}).call();
Opal.loaded(["corelib/runtime.js"]);
/* Generated by Opal 1.0.0 */
Opal.modules["corelib/helpers"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $module = Opal.module, $truthy = Opal.truthy, $send = Opal.send;

  return (function($base, $parent_nesting) {
    var self = $module($base, 'Opal');

    var $nesting = [self].concat($parent_nesting), $Opal_bridge$1, $Opal_type_error$2, $Opal_coerce_to$3, $Opal_coerce_to$excl$4, $Opal_coerce_to$ques$5, $Opal_try_convert$6, $Opal_compare$7, $Opal_destructure$8, $Opal_respond_to$ques$9, $Opal_inspect_obj$10, $Opal_instance_variable_name$excl$11, $Opal_class_variable_name$excl$12, $Opal_const_name$excl$13, $Opal_pristine$14;

    
    Opal.defs(self, '$bridge', $Opal_bridge$1 = function $$bridge(constructor, klass) {
      var self = this;

      return Opal.bridge(constructor, klass);
    }, $Opal_bridge$1.$$arity = 2);
    Opal.defs(self, '$type_error', $Opal_type_error$2 = function $$type_error(object, type, method, coerced) {
      var $a, self = this;

      
      
      if (method == null) {
        method = nil;
      };
      
      if (coerced == null) {
        coerced = nil;
      };
      if ($truthy(($truthy($a = method) ? coerced : $a))) {
        return $$($nesting, 'TypeError').$new("" + "can't convert " + (object.$class()) + " into " + (type) + " (" + (object.$class()) + "#" + (method) + " gives " + (coerced.$class()) + ")")
      } else {
        return $$($nesting, 'TypeError').$new("" + "no implicit conversion of " + (object.$class()) + " into " + (type))
      };
    }, $Opal_type_error$2.$$arity = -3);
    Opal.defs(self, '$coerce_to', $Opal_coerce_to$3 = function $$coerce_to(object, type, method, $a) {
      var $post_args, args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 3, arguments.length);
      
      args = $post_args;;
      if ($truthy(type['$==='](object))) {
        return object};
      if ($truthy(object['$respond_to?'](method))) {
      } else {
        self.$raise(self.$type_error(object, type))
      };
      return $send(object, '__send__', [method].concat(Opal.to_a(args)));
    }, $Opal_coerce_to$3.$$arity = -4);
    Opal.defs(self, '$coerce_to!', $Opal_coerce_to$excl$4 = function(object, type, method, $a) {
      var $post_args, args, self = this, coerced = nil;

      
      
      $post_args = Opal.slice.call(arguments, 3, arguments.length);
      
      args = $post_args;;
      coerced = $send(self, 'coerce_to', [object, type, method].concat(Opal.to_a(args)));
      if ($truthy(type['$==='](coerced))) {
      } else {
        self.$raise(self.$type_error(object, type, method, coerced))
      };
      return coerced;
    }, $Opal_coerce_to$excl$4.$$arity = -4);
    Opal.defs(self, '$coerce_to?', $Opal_coerce_to$ques$5 = function(object, type, method, $a) {
      var $post_args, args, self = this, coerced = nil;

      
      
      $post_args = Opal.slice.call(arguments, 3, arguments.length);
      
      args = $post_args;;
      if ($truthy(object['$respond_to?'](method))) {
      } else {
        return nil
      };
      coerced = $send(self, 'coerce_to', [object, type, method].concat(Opal.to_a(args)));
      if ($truthy(coerced['$nil?']())) {
        return nil};
      if ($truthy(type['$==='](coerced))) {
      } else {
        self.$raise(self.$type_error(object, type, method, coerced))
      };
      return coerced;
    }, $Opal_coerce_to$ques$5.$$arity = -4);
    ;
    Opal.defs(self, '$compare', $Opal_compare$7 = function $$compare(a, b) {
      var self = this, compare = nil;

      
      compare = a['$<=>'](b);
      if ($truthy(compare === nil)) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "comparison of " + (a.$class()) + " with " + (b.$class()) + " failed")};
      return compare;
    }, $Opal_compare$7.$$arity = 2);
    Opal.defs(self, '$destructure', $Opal_destructure$8 = function $$destructure(args) {
      var self = this;

      
      if (args.length == 1) {
        return args[0];
      }
      else if (args.$$is_array) {
        return args;
      }
      else {
        var args_ary = new Array(args.length);
        for(var i = 0, l = args_ary.length; i < l; i++) { args_ary[i] = args[i]; }

        return args_ary;
      }
    
    }, $Opal_destructure$8.$$arity = 1);
    Opal.defs(self, '$respond_to?', $Opal_respond_to$ques$9 = function(obj, method, include_all) {
      var self = this;

      
      
      if (include_all == null) {
        include_all = false;
      };
      
      if (obj == null || !obj.$$class) {
        return false;
      }
    ;
      return obj['$respond_to?'](method, include_all);
    }, $Opal_respond_to$ques$9.$$arity = -3);
    ;
    ;
    ;
    Opal.defs(self, '$const_name!', $Opal_const_name$excl$13 = function(const_name) {
      var self = this;

      
      const_name = $$($nesting, 'Opal')['$coerce_to!'](const_name, $$($nesting, 'String'), "to_str");
      if ($truthy(const_name['$[]'](0)['$!='](const_name['$[]'](0).$upcase()))) {
        self.$raise($$($nesting, 'NameError'), "" + "wrong constant name " + (const_name))};
      return const_name;
    }, $Opal_const_name$excl$13.$$arity = 1);
    Opal.defs(self, '$pristine', $Opal_pristine$14 = function $$pristine(owner_class, $a) {
      var $post_args, method_names, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      method_names = $post_args;;
      
      var method_name, method;
      for (var i = method_names.length - 1; i >= 0; i--) {
        method_name = method_names[i];
        method = owner_class.$$prototype['$'+method_name];

        if (method && !method.$$stub) {
          method.$$pristine = true;
        }
      }
    ;
      return nil;
    }, $Opal_pristine$14.$$arity = -2);
  })($nesting[0], $nesting)
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/module"] = function(Opal) {
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $send = Opal.send, $truthy = Opal.truthy, $hash2 = Opal.hash2, $lambda = Opal.lambda, $range = Opal.range;

  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Module');

    var $nesting = [self].concat($parent_nesting), $Module_allocate$1, $Module_initialize$2, $Module_$eq_eq_eq$3, $Module_$lt$4, $Module_$lt_eq$5, $Module_$gt$6, $Module_$gt_eq$7, $Module_$lt_eq_gt$8, $Module_alias_method$9, $Module_alias_native$10, $Module_ancestors$11, $Module_append_features$12, $Module_attr_accessor$13, $Module_attr$14, $Module_attr_reader$15, $Module_attr_writer$16, $Module_autoload$17, $Module_class_variables$18, $Module_class_variable_get$19, $Module_class_variable_set$20, $Module_class_variable_defined$ques$21, $Module_remove_class_variable$22, $Module_constants$23, $Module_constants$24, $Module_nesting$25, $Module_const_defined$ques$26, $Module_const_get$27, $Module_const_missing$29, $Module_const_set$30, $Module_public_constant$31, $Module_define_method$32, $Module_remove_method$34, $Module_singleton_class$ques$35, $Module_include$36, $Module_included_modules$37, $Module_include$ques$38, $Module_instance_method$39, $Module_instance_methods$40, $Module_included$41, $Module_extended$42, $Module_extend_object$43, $Module_method_added$44, $Module_method_removed$45, $Module_method_undefined$46, $Module_module_eval$47, $Module_module_exec$49, $Module_method_defined$ques$50, $Module_module_function$51, $Module_name$52, $Module_prepend$53, $Module_prepend_features$54, $Module_prepended$55, $Module_remove_const$56, $Module_to_s$57, $Module_undef_method$58, $Module_instance_variables$59, $Module_dup$60, $Module_copy_class_variables$61, $Module_copy_constants$62;

    
    Opal.defs(self, '$allocate', $Module_allocate$1 = function $$allocate() {
      var self = this;

      
      var module = Opal.allocate_module(nil, function(){});
      // Link the prototype of Module subclasses
      if (self !== Opal.Module) Object.setPrototypeOf(module, self.$$prototype);
      return module;
    
    }, $Module_allocate$1.$$arity = 0);
    
    Opal.def(self, '$initialize', $Module_initialize$2 = function $$initialize() {
      var $iter = $Module_initialize$2.$$p, block = $iter || nil, self = this;

      if ($iter) $Module_initialize$2.$$p = null;
      
      
      if ($iter) $Module_initialize$2.$$p = null;;
      if ((block !== nil)) {
        return $send(self, 'module_eval', [], block.$to_proc())
      } else {
        return nil
      };
    }, $Module_initialize$2.$$arity = 0);
    
    Opal.def(self, '$===', $Module_$eq_eq_eq$3 = function(object) {
      var self = this;

      
      if ($truthy(object == null)) {
        return false};
      return Opal.is_a(object, self);;
    }, $Module_$eq_eq_eq$3.$$arity = 1);
    
    Opal.def(self, '$<', $Module_$lt$4 = function(other) {
      var self = this;

      
      if ($truthy($$($nesting, 'Module')['$==='](other))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "compared with non class/module")
      };
      
      var working = self,
          ancestors,
          i, length;

      if (working === other) {
        return false;
      }

      for (i = 0, ancestors = Opal.ancestors(self), length = ancestors.length; i < length; i++) {
        if (ancestors[i] === other) {
          return true;
        }
      }

      for (i = 0, ancestors = Opal.ancestors(other), length = ancestors.length; i < length; i++) {
        if (ancestors[i] === self) {
          return false;
        }
      }

      return nil;
    ;
    }, $Module_$lt$4.$$arity = 1);
    
    Opal.def(self, '$<=', $Module_$lt_eq$5 = function(other) {
      var $a, self = this;

      return ($truthy($a = self['$equal?'](other)) ? $a : $rb_lt(self, other))
    }, $Module_$lt_eq$5.$$arity = 1);
    
    Opal.def(self, '$>', $Module_$gt$6 = function(other) {
      var self = this;

      
      if ($truthy($$($nesting, 'Module')['$==='](other))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "compared with non class/module")
      };
      return $rb_lt(other, self);
    }, $Module_$gt$6.$$arity = 1);
    
    Opal.def(self, '$>=', $Module_$gt_eq$7 = function(other) {
      var $a, self = this;

      return ($truthy($a = self['$equal?'](other)) ? $a : $rb_gt(self, other))
    }, $Module_$gt_eq$7.$$arity = 1);
    
    Opal.def(self, '$<=>', $Module_$lt_eq_gt$8 = function(other) {
      var self = this, lt = nil;

      
      
      if (self === other) {
        return 0;
      }
    ;
      if ($truthy($$($nesting, 'Module')['$==='](other))) {
      } else {
        return nil
      };
      lt = $rb_lt(self, other);
      if ($truthy(lt['$nil?']())) {
        return nil};
      if ($truthy(lt)) {
        return -1
      } else {
        return 1
      };
    }, $Module_$lt_eq_gt$8.$$arity = 1);
    
    Opal.def(self, '$alias_method', $Module_alias_method$9 = function $$alias_method(newname, oldname) {
      var self = this;

      
      newname = $$($nesting, 'Opal').$coerce_to(newname, $$($nesting, 'String'), "to_str");
      oldname = $$($nesting, 'Opal').$coerce_to(oldname, $$($nesting, 'String'), "to_str");
      Opal.alias(self, newname, oldname);
      return self;
    }, $Module_alias_method$9.$$arity = 2);
    
    ;
    
    ;
    
    Opal.def(self, '$append_features', $Module_append_features$12 = function $$append_features(includer) {
      var self = this;

      
      Opal.append_features(self, includer);
      return self;
    }, $Module_append_features$12.$$arity = 1);
    
    Opal.def(self, '$attr_accessor', $Module_attr_accessor$13 = function $$attr_accessor($a) {
      var $post_args, names, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      names = $post_args;;
      $send(self, 'attr_reader', Opal.to_a(names));
      return $send(self, 'attr_writer', Opal.to_a(names));
    }, $Module_attr_accessor$13.$$arity = -1);
    
    ;
    
    Opal.def(self, '$attr_reader', $Module_attr_reader$15 = function $$attr_reader($a) {
      var $post_args, names, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      names = $post_args;;
      
      var proto = self.$$prototype;

      for (var i = names.length - 1; i >= 0; i--) {
        var name = names[i],
            id   = '$' + name,
            ivar = Opal.ivar(name);

        // the closure here is needed because name will change at the next
        // cycle, I wish we could use let.
        var body = (function(ivar) {
          return function() {
            if (this[ivar] == null) {
              return nil;
            }
            else {
              return this[ivar];
            }
          };
        })(ivar);

        // initialize the instance variable as nil
        Opal.defineProperty(proto, ivar, nil);

        body.$$parameters = [];
        body.$$arity = 0;

        Opal.defn(self, id, body);
      }
    ;
      return nil;
    }, $Module_attr_reader$15.$$arity = -1);
    
    Opal.def(self, '$attr_writer', $Module_attr_writer$16 = function $$attr_writer($a) {
      var $post_args, names, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      names = $post_args;;
      
      var proto = self.$$prototype;

      for (var i = names.length - 1; i >= 0; i--) {
        var name = names[i],
            id   = '$' + name + '=',
            ivar = Opal.ivar(name);

        // the closure here is needed because name will change at the next
        // cycle, I wish we could use let.
        var body = (function(ivar){
          return function(value) {
            return this[ivar] = value;
          }
        })(ivar);

        body.$$parameters = [['req']];
        body.$$arity = 1;

        // initialize the instance variable as nil
        Opal.defineProperty(proto, ivar, nil);

        Opal.defn(self, id, body);
      }
    ;
      return nil;
    }, $Module_attr_writer$16.$$arity = -1);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    ;
    ;
    
    Opal.def(self, '$const_defined?', $Module_const_defined$ques$26 = function(name, inherit) {
      var self = this;

      
      
      if (inherit == null) {
        inherit = true;
      };
      name = $$($nesting, 'Opal')['$const_name!'](name);
      if ($truthy(name['$=~']($$$($$($nesting, 'Opal'), 'CONST_NAME_REGEXP')))) {
      } else {
        self.$raise($$($nesting, 'NameError').$new("" + "wrong constant name " + (name), name))
      };
      
      var module, modules = [self], module_constants, i, ii;

      // Add up ancestors if inherit is true
      if (inherit) {
        modules = modules.concat(Opal.ancestors(self));

        // Add Object's ancestors if it's a module – modules have no ancestors otherwise
        if (self.$$is_module) {
          modules = modules.concat([Opal.Object]).concat(Opal.ancestors(Opal.Object));
        }
      }

      for (i = 0, ii = modules.length; i < ii; i++) {
        module = modules[i];
        if (module.$$const[name] != null) {
          return true;
        }
      }

      return false;
    ;
    }, $Module_const_defined$ques$26.$$arity = -2);
    
    Opal.def(self, '$const_get', $Module_const_get$27 = function $$const_get(name, inherit) {
      var $$28, self = this;

      
      
      if (inherit == null) {
        inherit = true;
      };
      name = $$($nesting, 'Opal')['$const_name!'](name);
      
      if (name.indexOf('::') === 0 && name !== '::'){
        name = name.slice(2);
      }
    ;
      if ($truthy(name.indexOf('::') != -1 && name != '::')) {
        return $send(name.$split("::"), 'inject', [self], ($$28 = function(o, c){var self = $$28.$$s == null ? this : $$28.$$s;

        
          
          if (o == null) {
            o = nil;
          };
          
          if (c == null) {
            c = nil;
          };
          return o.$const_get(c);}, $$28.$$s = self, $$28.$$arity = 2, $$28))};
      if ($truthy(name['$=~']($$$($$($nesting, 'Opal'), 'CONST_NAME_REGEXP')))) {
      } else {
        self.$raise($$($nesting, 'NameError').$new("" + "wrong constant name " + (name), name))
      };
      
      if (inherit) {
        return $$([self], name);
      } else {
        return Opal.const_get_local(self, name);
      }
    ;
    }, $Module_const_get$27.$$arity = -2);
    
    Opal.def(self, '$const_missing', $Module_const_missing$29 = function $$const_missing(name) {
      var self = this, full_const_name = nil;

      
      
      if (self.$$autoload) {
        var file = self.$$autoload[name];

        if (file) {
          self.$require(file);

          return self.$const_get(name);
        }
      }
    ;
      full_const_name = (function() {if (self['$==']($$($nesting, 'Object'))) {
        return name
      } else {
        return "" + (self) + "::" + (name)
      }; return nil; })();
      return self.$raise($$($nesting, 'NameError').$new("" + "uninitialized constant " + (full_const_name), name));
    }, $Module_const_missing$29.$$arity = 1);
    
    Opal.def(self, '$const_set', $Module_const_set$30 = function $$const_set(name, value) {
      var $a, self = this;

      
      name = $$($nesting, 'Opal')['$const_name!'](name);
      if ($truthy(($truthy($a = name['$!~']($$$($$($nesting, 'Opal'), 'CONST_NAME_REGEXP'))) ? $a : name['$start_with?']("::")))) {
        self.$raise($$($nesting, 'NameError').$new("" + "wrong constant name " + (name), name))};
      Opal.const_set(self, name, value);
      return value;
    }, $Module_const_set$30.$$arity = 2);
    
    ;
    
    Opal.def(self, '$define_method', $Module_define_method$32 = function $$define_method(name, method) {
      var $iter = $Module_define_method$32.$$p, block = $iter || nil, $a, $$33, self = this, $case = nil;

      if ($iter) $Module_define_method$32.$$p = null;
      
      
      if ($iter) $Module_define_method$32.$$p = null;;
      ;
      if ($truthy(method === undefined && block === nil)) {
        self.$raise($$($nesting, 'ArgumentError'), "tried to create a Proc object without a block")};
      block = ($truthy($a = block) ? $a : (function() {$case = method;
      if ($$($nesting, 'Proc')['$===']($case)) {return method}
      else if ($$($nesting, 'Method')['$===']($case)) {return method.$to_proc().$$unbound}
      else if ($$($nesting, 'UnboundMethod')['$===']($case)) {return $lambda(($$33 = function($b){var self = $$33.$$s == null ? this : $$33.$$s, $post_args, args, bound = nil;

      
        
        $post_args = Opal.slice.call(arguments, 0, arguments.length);
        
        args = $post_args;;
        bound = method.$bind(self);
        return $send(bound, 'call', Opal.to_a(args));}, $$33.$$s = self, $$33.$$arity = -1, $$33))}
      else {return self.$raise($$($nesting, 'TypeError'), "" + "wrong argument type " + (block.$class()) + " (expected Proc/Method)")}})());
      
      var id = '$' + name;

      block.$$jsid        = name;
      block.$$s           = null;
      block.$$def         = block;
      block.$$define_meth = true;

      Opal.defn(self, id, block);

      return name;
    ;
    }, $Module_define_method$32.$$arity = -2);
    
    ;
    
    ;
    
    Opal.def(self, '$include', $Module_include$36 = function $$include($a) {
      var $post_args, mods, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      mods = $post_args;;
      
      for (var i = mods.length - 1; i >= 0; i--) {
        var mod = mods[i];

        if (!mod.$$is_module) {
          self.$raise($$($nesting, 'TypeError'), "" + "wrong argument type " + ((mod).$class()) + " (expected Module)");
        }

        (mod).$append_features(self);
        (mod).$included(self);
      }
    ;
      return self;
    }, $Module_include$36.$$arity = -1);
    
    ;
    
    Opal.def(self, '$include?', $Module_include$ques$38 = function(mod) {
      var self = this;

      
      if (!mod.$$is_module) {
        self.$raise($$($nesting, 'TypeError'), "" + "wrong argument type " + ((mod).$class()) + " (expected Module)");
      }

      var i, ii, mod2, ancestors = Opal.ancestors(self);

      for (i = 0, ii = ancestors.length; i < ii; i++) {
        mod2 = ancestors[i];
        if (mod2 === mod && mod2 !== self) {
          return true;
        }
      }

      return false;
    
    }, $Module_include$ques$38.$$arity = 1);
    
    ;
    
    ;
    
    Opal.def(self, '$included', $Module_included$41 = function $$included(mod) {
      var self = this;

      return nil
    }, $Module_included$41.$$arity = 1);
    
    Opal.def(self, '$extended', $Module_extended$42 = function $$extended(mod) {
      var self = this;

      return nil
    }, $Module_extended$42.$$arity = 1);
    
    Opal.def(self, '$extend_object', $Module_extend_object$43 = function $$extend_object(object) {
      var self = this;

      return nil
    }, $Module_extend_object$43.$$arity = 1);
    
    Opal.def(self, '$method_added', $Module_method_added$44 = function $$method_added($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return nil;
    }, $Module_method_added$44.$$arity = -1);
    
    ;
    
    Opal.def(self, '$method_undefined', $Module_method_undefined$46 = function $$method_undefined($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return nil;
    }, $Module_method_undefined$46.$$arity = -1);
    
    Opal.def(self, '$module_eval', $Module_module_eval$47 = function $$module_eval($a) {
      var $iter = $Module_module_eval$47.$$p, block = $iter || nil, $post_args, args, $b, $$48, self = this, string = nil, file = nil, _lineno = nil, default_eval_options = nil, compiling_options = nil, compiled = nil;

      if ($iter) $Module_module_eval$47.$$p = null;
      
      
      if ($iter) $Module_module_eval$47.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      if ($truthy(($truthy($b = block['$nil?']()) ? !!Opal.compile : $b))) {
        
        if ($truthy($range(1, 3, false)['$cover?'](args.$size()))) {
        } else {
          $$($nesting, 'Kernel').$raise($$($nesting, 'ArgumentError'), "wrong number of arguments (0 for 1..3)")
        };
        $b = [].concat(Opal.to_a(args)), (string = ($b[0] == null ? nil : $b[0])), (file = ($b[1] == null ? nil : $b[1])), (_lineno = ($b[2] == null ? nil : $b[2])), $b;
        default_eval_options = $hash2(["file", "eval"], {"file": ($truthy($b = file) ? $b : "(eval)"), "eval": true});
        compiling_options = Opal.hash({ arity_check: false }).$merge(default_eval_options);
        compiled = $$($nesting, 'Opal').$compile(string, compiling_options);
        block = $send($$($nesting, 'Kernel'), 'proc', [], ($$48 = function(){var self = $$48.$$s == null ? this : $$48.$$s;

        
          return (function(self) {
            return eval(compiled);
          })(self)
        }, $$48.$$s = self, $$48.$$arity = 0, $$48));
      } else if ($truthy(args['$any?']())) {
        $$($nesting, 'Kernel').$raise($$($nesting, 'ArgumentError'), "" + ("" + "wrong number of arguments (" + (args.$size()) + " for 0)") + "\n\n  NOTE:If you want to enable passing a String argument please add \"require 'opal-parser'\" to your script\n")};
      
      var old = block.$$s,
          result;

      block.$$s = null;
      result = block.apply(self, [self]);
      block.$$s = old;

      return result;
    ;
    }, $Module_module_eval$47.$$arity = -1);
    ;
    
    ;
    ;
    
    ;
    
    Opal.def(self, '$module_function', $Module_module_function$51 = function $$module_function($a) {
      var $post_args, methods, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      methods = $post_args;;
      
      if (methods.length === 0) {
        self.$$module_function = true;
      }
      else {
        for (var i = 0, length = methods.length; i < length; i++) {
          var meth = methods[i],
              id   = '$' + meth,
              func = self.$$prototype[id];

          Opal.defs(self, id, func);
        }
      }

      return self;
    ;
    }, $Module_module_function$51.$$arity = -1);
    
    Opal.def(self, '$name', $Module_name$52 = function $$name() {
      var self = this;

      
      if (self.$$full_name) {
        return self.$$full_name;
      }

      var result = [], base = self;

      while (base) {
        // Give up if any of the ancestors is unnamed
        if (base.$$name === nil || base.$$name == null) return nil;

        result.unshift(base.$$name);

        base = base.$$base_module;

        if (base === Opal.Object) {
          break;
        }
      }

      if (result.length === 0) {
        return nil;
      }

      return self.$$full_name = result.join('::');
    
    }, $Module_name$52.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$to_s', $Module_to_s$57 = function $$to_s() {
      var $a, self = this;

      return ($truthy($a = Opal.Module.$name.call(self)) ? $a : "" + "#<" + (self.$$is_module ? 'Module' : 'Class') + ":0x" + (self.$__id__().$to_s(16)) + ">")
    }, $Module_to_s$57.$$arity = 0);
    
    ;
    
    ;
    
    Opal.def(self, '$dup', $Module_dup$60 = function $$dup() {
      var $iter = $Module_dup$60.$$p, $yield = $iter || nil, self = this, copy = nil, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Module_dup$60.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      
      copy = $send(self, Opal.find_super_dispatcher(self, 'dup', $Module_dup$60, false), $zuper, $iter);
      copy.$copy_class_variables(self);
      copy.$copy_constants(self);
      return copy;
    }, $Module_dup$60.$$arity = 0);
    
    Opal.def(self, '$copy_class_variables', $Module_copy_class_variables$61 = function $$copy_class_variables(other) {
      var self = this;

      
      for (var name in other.$$cvars) {
        self.$$cvars[name] = other.$$cvars[name];
      }
    
    }, $Module_copy_class_variables$61.$$arity = 1);
    return (Opal.def(self, '$copy_constants', $Module_copy_constants$62 = function $$copy_constants(other) {
      var self = this;

      
      var name, other_constants = other.$$const;

      for (name in other_constants) {
        Opal.const_set(self, name, other_constants[name]);
      }
    
    }, $Module_copy_constants$62.$$arity = 1), nil) && 'copy_constants';
  })($nesting[0], null, $nesting)
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/class"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $send = Opal.send;

  
  self.$require("corelib/module");
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Class');

    var $nesting = [self].concat($parent_nesting), $Class_new$1, $Class_allocate$2, $Class_inherited$3, $Class_initialize_dup$4, $Class_new$5, $Class_superclass$6, $Class_to_s$7;

    
    Opal.defs(self, '$new', $Class_new$1 = function(superclass) {
      var $iter = $Class_new$1.$$p, block = $iter || nil, self = this;

      if ($iter) $Class_new$1.$$p = null;
      
      
      if ($iter) $Class_new$1.$$p = null;;
      
      if (superclass == null) {
        superclass = $$($nesting, 'Object');
      };
      
      if (!superclass.$$is_class) {
        throw Opal.TypeError.$new("superclass must be a Class");
      }

      var klass = Opal.allocate_class(nil, superclass);
      superclass.$inherited(klass);
      (function() {if ((block !== nil)) {
        return $send((klass), 'class_eval', [], block.$to_proc())
      } else {
        return nil
      }; return nil; })()
      return klass;
    ;
    }, $Class_new$1.$$arity = -1);
    
    Opal.def(self, '$allocate', $Class_allocate$2 = function $$allocate() {
      var self = this;

      
      var obj = new self.$$constructor();
      obj.$$id = Opal.uid();
      return obj;
    
    }, $Class_allocate$2.$$arity = 0);
    
    Opal.def(self, '$inherited', $Class_inherited$3 = function $$inherited(cls) {
      var self = this;

      return nil
    }, $Class_inherited$3.$$arity = 1);
    
    Opal.def(self, '$initialize_dup', $Class_initialize_dup$4 = function $$initialize_dup(original) {
      var self = this;

      
      self.$initialize_copy(original);
      
      self.$$name = null;
      self.$$full_name = null;
    ;
    }, $Class_initialize_dup$4.$$arity = 1);
    
    Opal.def(self, '$new', $Class_new$5 = function($a) {
      var $iter = $Class_new$5.$$p, block = $iter || nil, $post_args, args, self = this;

      if ($iter) $Class_new$5.$$p = null;
      
      
      if ($iter) $Class_new$5.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      
      var object = self.$allocate();
      Opal.send(object, object.$initialize, args, block);
      return object;
    ;
    }, $Class_new$5.$$arity = -1);
    
    ;
    return (Opal.def(self, '$to_s', $Class_to_s$7 = function $$to_s() {
      var $iter = $Class_to_s$7.$$p, $yield = $iter || nil, self = this;

      if ($iter) $Class_to_s$7.$$p = null;
      
      var singleton_of = self.$$singleton_of;

      if (singleton_of && (singleton_of.$$is_a_module)) {
        return "" + "#<Class:" + ((singleton_of).$name()) + ">";
      }
      else if (singleton_of) {
        // a singleton class created from an object
        return "" + "#<Class:#<" + ((singleton_of.$$class).$name()) + ":0x" + ((Opal.id(singleton_of)).$to_s(16)) + ">>";
      }
      return $send(self, Opal.find_super_dispatcher(self, 'to_s', $Class_to_s$7, false), [], null);
    
    }, $Class_to_s$7.$$arity = 0), nil) && 'to_s';
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/basic_object"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $range = Opal.range, $hash2 = Opal.hash2, $send = Opal.send;

  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'BasicObject');

    var $nesting = [self].concat($parent_nesting), $BasicObject_initialize$1, $BasicObject_$eq_eq$2, $BasicObject_eql$ques$3, $BasicObject___id__$4, $BasicObject___send__$5, $BasicObject_$excl$6, $BasicObject_$not_eq$7, $BasicObject_instance_eval$8, $BasicObject_instance_exec$10, $BasicObject_singleton_method_added$11, $BasicObject_singleton_method_removed$12, $BasicObject_singleton_method_undefined$13, $BasicObject_class$14, $BasicObject_method_missing$15, $BasicObject_respond_to_missing$ques$16;

    
    
    Opal.def(self, '$initialize', $BasicObject_initialize$1 = function $$initialize($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return nil;
    }, $BasicObject_initialize$1.$$arity = -1);
    
    Opal.def(self, '$==', $BasicObject_$eq_eq$2 = function(other) {
      var self = this;

      return self === other;
    }, $BasicObject_$eq_eq$2.$$arity = 1);
    
    Opal.def(self, '$eql?', $BasicObject_eql$ques$3 = function(other) {
      var self = this;

      return self['$=='](other)
    }, $BasicObject_eql$ques$3.$$arity = 1);
    Opal.alias(self, "equal?", "==");
    
    Opal.def(self, '$__id__', $BasicObject___id__$4 = function $$__id__() {
      var self = this;

      
      if (self.$$id != null) {
        return self.$$id;
      }
      Opal.defineProperty(self, '$$id', Opal.uid());
      return self.$$id;
    
    }, $BasicObject___id__$4.$$arity = 0);
    
    Opal.def(self, '$__send__', $BasicObject___send__$5 = function $$__send__(symbol, $a) {
      var $iter = $BasicObject___send__$5.$$p, block = $iter || nil, $post_args, args, self = this;

      if ($iter) $BasicObject___send__$5.$$p = null;
      
      
      if ($iter) $BasicObject___send__$5.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      args = $post_args;;
      
      var func = self['$' + symbol]

      if (func) {
        if (block !== nil) {
          func.$$p = block;
        }

        return func.apply(self, args);
      }

      if (block !== nil) {
        self.$method_missing.$$p = block;
      }

      return self.$method_missing.apply(self, [symbol].concat(args));
    ;
    }, $BasicObject___send__$5.$$arity = -2);
    
    Opal.def(self, '$!', $BasicObject_$excl$6 = function() {
      var self = this;

      return false
    }, $BasicObject_$excl$6.$$arity = 0);
    
    Opal.def(self, '$!=', $BasicObject_$not_eq$7 = function(other) {
      var self = this;

      return self['$=='](other)['$!']()
    }, $BasicObject_$not_eq$7.$$arity = 1);
    
    Opal.def(self, '$instance_eval', $BasicObject_instance_eval$8 = function $$instance_eval($a) {
      var $iter = $BasicObject_instance_eval$8.$$p, block = $iter || nil, $post_args, args, $b, $$9, self = this, string = nil, file = nil, _lineno = nil, default_eval_options = nil, compiling_options = nil, compiled = nil;

      if ($iter) $BasicObject_instance_eval$8.$$p = null;
      
      
      if ($iter) $BasicObject_instance_eval$8.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      if ($truthy(($truthy($b = block['$nil?']()) ? !!Opal.compile : $b))) {
        
        if ($truthy($range(1, 3, false)['$cover?'](args.$size()))) {
        } else {
          $$$('::', 'Kernel').$raise($$$('::', 'ArgumentError'), "wrong number of arguments (0 for 1..3)")
        };
        $b = [].concat(Opal.to_a(args)), (string = ($b[0] == null ? nil : $b[0])), (file = ($b[1] == null ? nil : $b[1])), (_lineno = ($b[2] == null ? nil : $b[2])), $b;
        default_eval_options = $hash2(["file", "eval"], {"file": ($truthy($b = file) ? $b : "(eval)"), "eval": true});
        compiling_options = Opal.hash({ arity_check: false }).$merge(default_eval_options);
        compiled = $$$('::', 'Opal').$compile(string, compiling_options);
        block = $send($$$('::', 'Kernel'), 'proc', [], ($$9 = function(){var self = $$9.$$s == null ? this : $$9.$$s;

        
          return (function(self) {
            return eval(compiled);
          })(self)
        }, $$9.$$s = self, $$9.$$arity = 0, $$9));
      } else if ($truthy(args['$any?']())) {
        $$$('::', 'Kernel').$raise($$$('::', 'ArgumentError'), "" + "wrong number of arguments (" + (args.$size()) + " for 0)")};
      
      var old = block.$$s,
          result;

      block.$$s = null;

      // Need to pass $$eval so that method definitions know if this is
      // being done on a class/module. Cannot be compiler driven since
      // send(:instance_eval) needs to work.
      if (self.$$is_a_module) {
        self.$$eval = true;
        try {
          result = block.call(self, self);
        }
        finally {
          self.$$eval = false;
        }
      }
      else {
        result = block.call(self, self);
      }

      block.$$s = old;

      return result;
    ;
    }, $BasicObject_instance_eval$8.$$arity = -1);
    
    ;
    
    Opal.def(self, '$singleton_method_added', $BasicObject_singleton_method_added$11 = function $$singleton_method_added($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return nil;
    }, $BasicObject_singleton_method_added$11.$$arity = -1);
    
    ;
    
    Opal.def(self, '$singleton_method_undefined', $BasicObject_singleton_method_undefined$13 = function $$singleton_method_undefined($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return nil;
    }, $BasicObject_singleton_method_undefined$13.$$arity = -1);
    
    Opal.def(self, '$class', $BasicObject_class$14 = function() {
      var self = this;

      return self.$$class;
    }, $BasicObject_class$14.$$arity = 0);
    
    Opal.def(self, '$method_missing', $BasicObject_method_missing$15 = function $$method_missing(symbol, $a) {
      var $iter = $BasicObject_method_missing$15.$$p, block = $iter || nil, $post_args, args, self = this, message = nil;

      if ($iter) $BasicObject_method_missing$15.$$p = null;
      
      
      if ($iter) $BasicObject_method_missing$15.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      args = $post_args;;
      message = (function() {if ($truthy(self.$inspect && !self.$inspect.$$stub)) {
        return "" + "undefined method `" + (symbol) + "' for " + (self.$inspect()) + ":" + (self.$$class)
      } else {
        return "" + "undefined method `" + (symbol) + "' for " + (self.$$class)
      }; return nil; })();
      return $$$('::', 'Kernel').$raise($$$('::', 'NoMethodError').$new(message, symbol));
    }, $BasicObject_method_missing$15.$$arity = -2);
    return (Opal.def(self, '$respond_to_missing?', $BasicObject_respond_to_missing$ques$16 = function(method_name, include_all) {
      var self = this;

      
      
      if (include_all == null) {
        include_all = false;
      };
      return false;
    }, $BasicObject_respond_to_missing$ques$16.$$arity = -2), nil) && 'respond_to_missing?';
  })($nesting[0], null, $nesting)
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/kernel"] = function(Opal) {
  function $rb_le(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs <= rhs : lhs['$<='](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $module = Opal.module, $truthy = Opal.truthy, $gvars = Opal.gvars, $hash2 = Opal.hash2, $send = Opal.send, $klass = Opal.klass;

  
  (function($base, $parent_nesting) {
    var self = $module($base, 'Kernel');

    var $nesting = [self].concat($parent_nesting), $Kernel_method_missing$1, $Kernel_$eq_tilde$2, $Kernel_$excl_tilde$3, $Kernel_$eq_eq_eq$4, $Kernel_$lt_eq_gt$5, $Kernel_method$6, $Kernel_methods$7, $Kernel_public_methods$8, $Kernel_Array$9, $Kernel_at_exit$10, $Kernel_caller$11, $Kernel_class$12, $Kernel_copy_instance_variables$13, $Kernel_copy_singleton_methods$14, $Kernel_clone$15, $Kernel_initialize_clone$16, $Kernel_define_singleton_method$17, $Kernel_dup$18, $Kernel_initialize_dup$19, $Kernel_enum_for$20, $Kernel_equal$ques$21, $Kernel_exit$22, $Kernel_extend$23, $Kernel_hash$24, $Kernel_initialize_copy$25, $Kernel_inspect$26, $Kernel_instance_of$ques$27, $Kernel_instance_variable_defined$ques$28, $Kernel_instance_variable_get$29, $Kernel_instance_variable_set$30, $Kernel_remove_instance_variable$31, $Kernel_instance_variables$32, $Kernel_Integer$33, $Kernel_Float$34, $Kernel_Hash$35, $Kernel_is_a$ques$36, $Kernel_itself$37, $Kernel_lambda$38, $Kernel_load$39, $Kernel_loop$40, $Kernel_nil$ques$42, $Kernel_printf$43, $Kernel_proc$44, $Kernel_puts$45, $Kernel_p$46, $Kernel_print$48, $Kernel_warn$49, $Kernel_raise$51, $Kernel_rand$52, $Kernel_respond_to$ques$53, $Kernel_respond_to_missing$ques$54, $Kernel_require$55, $Kernel_require_relative$56, $Kernel_require_tree$57, $Kernel_singleton_class$58, $Kernel_sleep$59, $Kernel_srand$60, $Kernel_String$61, $Kernel_tap$62, $Kernel_to_proc$63, $Kernel_to_s$64, $Kernel_catch$65, $Kernel_throw$66, $Kernel_open$67, $Kernel_yield_self$68;

    
    
    Opal.def(self, '$method_missing', $Kernel_method_missing$1 = function $$method_missing(symbol, $a) {
      var $iter = $Kernel_method_missing$1.$$p, block = $iter || nil, $post_args, args, self = this;

      if ($iter) $Kernel_method_missing$1.$$p = null;
      
      
      if ($iter) $Kernel_method_missing$1.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      args = $post_args;;
      return self.$raise($$($nesting, 'NoMethodError').$new("" + "undefined method `" + (symbol) + "' for " + (self.$inspect()), symbol, args));
    }, $Kernel_method_missing$1.$$arity = -2);
    
    Opal.def(self, '$=~', $Kernel_$eq_tilde$2 = function(obj) {
      var self = this;

      return false
    }, $Kernel_$eq_tilde$2.$$arity = 1);
    
    Opal.def(self, '$!~', $Kernel_$excl_tilde$3 = function(obj) {
      var self = this;

      return self['$=~'](obj)['$!']()
    }, $Kernel_$excl_tilde$3.$$arity = 1);
    
    Opal.def(self, '$===', $Kernel_$eq_eq_eq$4 = function(other) {
      var $a, self = this;

      return ($truthy($a = self.$object_id()['$=='](other.$object_id())) ? $a : self['$=='](other))
    }, $Kernel_$eq_eq_eq$4.$$arity = 1);
    
    Opal.def(self, '$<=>', $Kernel_$lt_eq_gt$5 = function(other) {
      var self = this;

      
      // set guard for infinite recursion
      self.$$comparable = true;

      var x = self['$=='](other);

      if (x && x !== nil) {
        return 0;
      }

      return nil;
    
    }, $Kernel_$lt_eq_gt$5.$$arity = 1);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$caller', $Kernel_caller$11 = function $$caller($a) {
      var $post_args, args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      return [];
    }, $Kernel_caller$11.$$arity = -1);
    
    Opal.def(self, '$class', $Kernel_class$12 = function() {
      var self = this;

      return self.$$class;
    }, $Kernel_class$12.$$arity = 0);
    
    Opal.def(self, '$copy_instance_variables', $Kernel_copy_instance_variables$13 = function $$copy_instance_variables(other) {
      var self = this;

      
      var keys = Object.keys(other), i, ii, name;
      for (i = 0, ii = keys.length; i < ii; i++) {
        name = keys[i];
        if (name.charAt(0) !== '$' && other.hasOwnProperty(name)) {
          self[name] = other[name];
        }
      }
    
    }, $Kernel_copy_instance_variables$13.$$arity = 1);
    
    Opal.def(self, '$copy_singleton_methods', $Kernel_copy_singleton_methods$14 = function $$copy_singleton_methods(other) {
      var self = this;

      
      var i, name, names, length;

      if (other.hasOwnProperty('$$meta')) {
        var other_singleton_class = Opal.get_singleton_class(other);
        var self_singleton_class = Opal.get_singleton_class(self);
        names = Object.getOwnPropertyNames(other_singleton_class.$$prototype);

        for (i = 0, length = names.length; i < length; i++) {
          name = names[i];
          if (Opal.is_method(name)) {
            self_singleton_class.$$prototype[name] = other_singleton_class.$$prototype[name];
          }
        }

        self_singleton_class.$$const = Object.assign({}, other_singleton_class.$$const);
        Object.setPrototypeOf(
          self_singleton_class.$$prototype,
          Object.getPrototypeOf(other_singleton_class.$$prototype)
        );
      }

      for (i = 0, names = Object.getOwnPropertyNames(other), length = names.length; i < length; i++) {
        name = names[i];
        if (name.charAt(0) === '$' && name.charAt(1) !== '$' && other.hasOwnProperty(name)) {
          self[name] = other[name];
        }
      }
    
    }, $Kernel_copy_singleton_methods$14.$$arity = 1);
    
    Opal.def(self, '$clone', $Kernel_clone$15 = function $$clone($kwargs) {
      var freeze, self = this, copy = nil;

      
      
      if ($kwargs == null) {
        $kwargs = $hash2([], {});
      } else if (!$kwargs.$$is_hash) {
        throw Opal.ArgumentError.$new('expected kwargs');
      };
      
      freeze = $kwargs.$$smap["freeze"];
      if (freeze == null) {
        freeze = true
      };
      copy = self.$class().$allocate();
      copy.$copy_instance_variables(self);
      copy.$copy_singleton_methods(self);
      copy.$initialize_clone(self);
      return copy;
    }, $Kernel_clone$15.$$arity = -1);
    
    Opal.def(self, '$initialize_clone', $Kernel_initialize_clone$16 = function $$initialize_clone(other) {
      var self = this;

      return self.$initialize_copy(other)
    }, $Kernel_initialize_clone$16.$$arity = 1);
    
    ;
    
    Opal.def(self, '$dup', $Kernel_dup$18 = function $$dup() {
      var self = this, copy = nil;

      
      copy = self.$class().$allocate();
      copy.$copy_instance_variables(self);
      copy.$initialize_dup(self);
      return copy;
    }, $Kernel_dup$18.$$arity = 0);
    
    Opal.def(self, '$initialize_dup', $Kernel_initialize_dup$19 = function $$initialize_dup(other) {
      var self = this;

      return self.$initialize_copy(other)
    }, $Kernel_initialize_dup$19.$$arity = 1);
    
    Opal.def(self, '$enum_for', $Kernel_enum_for$20 = function $$enum_for($a, $b) {
      var $iter = $Kernel_enum_for$20.$$p, block = $iter || nil, $post_args, method, args, self = this;

      if ($iter) $Kernel_enum_for$20.$$p = null;
      
      
      if ($iter) $Kernel_enum_for$20.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      if ($post_args.length > 0) {
        method = $post_args[0];
        $post_args.splice(0, 1);
      }
      if (method == null) {
        method = "each";
      };
      
      args = $post_args;;
      return $send($$($nesting, 'Enumerator'), 'for', [self, method].concat(Opal.to_a(args)), block.$to_proc());
    }, $Kernel_enum_for$20.$$arity = -1);
    ;
    
    Opal.def(self, '$equal?', $Kernel_equal$ques$21 = function(other) {
      var self = this;

      return self === other;
    }, $Kernel_equal$ques$21.$$arity = 1);
    
    ;
    
    Opal.def(self, '$extend', $Kernel_extend$23 = function $$extend($a) {
      var $post_args, mods, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      mods = $post_args;;
      
      var singleton = self.$singleton_class();

      for (var i = mods.length - 1; i >= 0; i--) {
        var mod = mods[i];

        if (!mod.$$is_module) {
          self.$raise($$($nesting, 'TypeError'), "" + "wrong argument type " + ((mod).$class()) + " (expected Module)");
        }

        (mod).$append_features(singleton);
        (mod).$extend_object(self);
        (mod).$extended(self);
      }
    ;
      return self;
    }, $Kernel_extend$23.$$arity = -1);
    
    Opal.def(self, '$hash', $Kernel_hash$24 = function $$hash() {
      var self = this;

      return self.$__id__()
    }, $Kernel_hash$24.$$arity = 0);
    
    Opal.def(self, '$initialize_copy', $Kernel_initialize_copy$25 = function $$initialize_copy(other) {
      var self = this;

      return nil
    }, $Kernel_initialize_copy$25.$$arity = 1);
    
    Opal.def(self, '$inspect', $Kernel_inspect$26 = function $$inspect() {
      var self = this;

      return self.$to_s()
    }, $Kernel_inspect$26.$$arity = 0);
    
    Opal.def(self, '$instance_of?', $Kernel_instance_of$ques$27 = function(klass) {
      var self = this;

      
      if (!klass.$$is_class && !klass.$$is_module) {
        self.$raise($$($nesting, 'TypeError'), "class or module required");
      }

      return self.$$class === klass;
    
    }, $Kernel_instance_of$ques$27.$$arity = 1);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$Integer', $Kernel_Integer$33 = function $$Integer(value, base) {
      var self = this;

      
      ;
      
      var i, str, base_digits;

      if (!value.$$is_string) {
        if (base !== undefined) {
          self.$raise($$($nesting, 'ArgumentError'), "base specified for non string value")
        }
        if (value === nil) {
          self.$raise($$($nesting, 'TypeError'), "can't convert nil into Integer")
        }
        if (value.$$is_number) {
          if (value === Infinity || value === -Infinity || isNaN(value)) {
            self.$raise($$($nesting, 'FloatDomainError'), value)
          }
          return Math.floor(value);
        }
        if (value['$respond_to?']("to_int")) {
          i = value.$to_int();
          if (i !== nil) {
            return i;
          }
        }
        return $$($nesting, 'Opal')['$coerce_to!'](value, $$($nesting, 'Integer'), "to_i");
      }

      if (value === "0") {
        return 0;
      }

      if (base === undefined) {
        base = 0;
      } else {
        base = $$($nesting, 'Opal').$coerce_to(base, $$($nesting, 'Integer'), "to_int");
        if (base === 1 || base < 0 || base > 36) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "invalid radix " + (base))
        }
      }

      str = value.toLowerCase();

      str = str.replace(/(\d)_(?=\d)/g, '$1');

      str = str.replace(/^(\s*[+-]?)(0[bodx]?)/, function (_, head, flag) {
        switch (flag) {
        case '0b':
          if (base === 0 || base === 2) {
            base = 2;
            return head;
          }
        case '0':
        case '0o':
          if (base === 0 || base === 8) {
            base = 8;
            return head;
          }
        case '0d':
          if (base === 0 || base === 10) {
            base = 10;
            return head;
          }
        case '0x':
          if (base === 0 || base === 16) {
            base = 16;
            return head;
          }
        }
        self.$raise($$($nesting, 'ArgumentError'), "" + "invalid value for Integer(): \"" + (value) + "\"")
      });

      base = (base === 0 ? 10 : base);

      base_digits = '0-' + (base <= 10 ? base - 1 : '9a-' + String.fromCharCode(97 + (base - 11)));

      if (!(new RegExp('^\\s*[+-]?[' + base_digits + ']+\\s*$')).test(str)) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "invalid value for Integer(): \"" + (value) + "\"")
      }

      i = parseInt(str, base);

      if (isNaN(i)) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "invalid value for Integer(): \"" + (value) + "\"")
      }

      return i;
    ;
    }, $Kernel_Integer$33.$$arity = -2);
    
    Opal.def(self, '$Float', $Kernel_Float$34 = function $$Float(value) {
      var self = this;

      
      var str;

      if (value === nil) {
        self.$raise($$($nesting, 'TypeError'), "can't convert nil into Float")
      }

      if (value.$$is_string) {
        str = value.toString();

        str = str.replace(/(\d)_(?=\d)/g, '$1');

        //Special case for hex strings only:
        if (/^\s*[-+]?0[xX][0-9a-fA-F]+\s*$/.test(str)) {
          return self.$Integer(str);
        }

        if (!/^\s*[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?\s*$/.test(str)) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "invalid value for Float(): \"" + (value) + "\"")
        }

        return parseFloat(str);
      }

      return $$($nesting, 'Opal')['$coerce_to!'](value, $$($nesting, 'Float'), "to_f");
    
    }, $Kernel_Float$34.$$arity = 1);
    
    ;
    
    Opal.def(self, '$is_a?', $Kernel_is_a$ques$36 = function(klass) {
      var self = this;

      
      if (!klass.$$is_class && !klass.$$is_module) {
        self.$raise($$($nesting, 'TypeError'), "class or module required");
      }

      return Opal.is_a(self, klass);
    
    }, $Kernel_is_a$ques$36.$$arity = 1);
    
    ;
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$nil?', $Kernel_nil$ques$42 = function() {
      var self = this;

      return false
    }, $Kernel_nil$ques$42.$$arity = 0);
    Opal.alias(self, "object_id", "__id__");
    
    ;
    
    Opal.def(self, '$proc', $Kernel_proc$44 = function $$proc() {
      var $iter = $Kernel_proc$44.$$p, block = $iter || nil, self = this;

      if ($iter) $Kernel_proc$44.$$p = null;
      
      
      if ($iter) $Kernel_proc$44.$$p = null;;
      if ($truthy(block)) {
      } else {
        self.$raise($$($nesting, 'ArgumentError'), "tried to create Proc object without a block")
      };
      block.$$is_lambda = false;
      return block;
    }, $Kernel_proc$44.$$arity = 0);
    
    Opal.def(self, '$puts', $Kernel_puts$45 = function $$puts($a) {
      var $post_args, strs, self = this;
      if ($gvars.stdout == null) $gvars.stdout = nil;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      strs = $post_args;;
      return $send($gvars.stdout, 'puts', Opal.to_a(strs));
    }, $Kernel_puts$45.$$arity = -1);
    
    ;
    
    ;
    
    Opal.def(self, '$warn', $Kernel_warn$49 = function $$warn($a, $b) {
      var $post_args, $kwargs, strs, uplevel, $$50, $c, self = this;
      if ($gvars.VERBOSE == null) $gvars.VERBOSE = nil;
      if ($gvars.stderr == null) $gvars.stderr = nil;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      $kwargs = Opal.extract_kwargs($post_args);
      
      if ($kwargs == null) {
        $kwargs = $hash2([], {});
      } else if (!$kwargs.$$is_hash) {
        throw Opal.ArgumentError.$new('expected kwargs');
      };
      
      strs = $post_args;;
      
      uplevel = $kwargs.$$smap["uplevel"];
      if (uplevel == null) {
        uplevel = nil
      };
      if ($truthy(uplevel)) {
        
        uplevel = $$($nesting, 'Opal')['$coerce_to!'](uplevel, $$($nesting, 'Integer'), "to_str");
        if ($truthy($rb_lt(uplevel, 0))) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "negative level (" + (uplevel) + ")")};
        strs = $send(strs, 'map', [], ($$50 = function(s){var self = $$50.$$s == null ? this : $$50.$$s;

        
          
          if (s == null) {
            s = nil;
          };
          return "" + "warning: " + (self.$caller());}, $$50.$$s = self, $$50.$$arity = 1, $$50));};
      if ($truthy(($truthy($c = $gvars.VERBOSE['$nil?']()) ? $c : strs['$empty?']()))) {
        return nil
      } else {
        return $send($gvars.stderr, 'puts', Opal.to_a(strs))
      };
    }, $Kernel_warn$49.$$arity = -1);
    
    Opal.def(self, '$raise', $Kernel_raise$51 = function $$raise(exception, string, _backtrace) {
      var self = this;
      if ($gvars["!"] == null) $gvars["!"] = nil;

      
      ;
      
      if (string == null) {
        string = nil;
      };
      
      if (_backtrace == null) {
        _backtrace = nil;
      };
      
      if (exception == null && $gvars["!"] !== nil) {
        throw $gvars["!"];
      }
      if (exception == null) {
        exception = $$($nesting, 'RuntimeError').$new();
      }
      else if (exception.$$is_string) {
        exception = $$($nesting, 'RuntimeError').$new(exception);
      }
      // using respond_to? and not an undefined check to avoid method_missing matching as true
      else if (exception.$$is_class && exception['$respond_to?']("exception")) {
        exception = exception.$exception(string);
      }
      else if (exception['$is_a?']($$($nesting, 'Exception'))) {
        // exception is fine
      }
      else {
        exception = $$($nesting, 'TypeError').$new("exception class/object expected");
      }

      if ($gvars["!"] !== nil) {
        Opal.exceptions.push($gvars["!"]);
      }

      $gvars["!"] = exception;

      throw exception;
    ;
    }, $Kernel_raise$51.$$arity = -1);
    ;
    
    Opal.def(self, '$rand', $Kernel_rand$52 = function $$rand(max) {
      var self = this;

      
      ;
      
      if (max === undefined) {
        return $$$($$($nesting, 'Random'), 'DEFAULT').$rand();
      }

      if (max.$$is_number) {
        if (max < 0) {
          max = Math.abs(max);
        }

        if (max % 1 !== 0) {
          max = max.$to_i();
        }

        if (max === 0) {
          max = undefined;
        }
      }
    ;
      return $$$($$($nesting, 'Random'), 'DEFAULT').$rand(max);
    }, $Kernel_rand$52.$$arity = -1);
    
    Opal.def(self, '$respond_to?', $Kernel_respond_to$ques$53 = function(name, include_all) {
      var self = this;

      
      
      if (include_all == null) {
        include_all = false;
      };
      if ($truthy(self['$respond_to_missing?'](name, include_all))) {
        return true};
      
      var body = self['$' + name];

      if (typeof(body) === "function" && !body.$$stub) {
        return true;
      }
    ;
      return false;
    }, $Kernel_respond_to$ques$53.$$arity = -2);
    
    Opal.def(self, '$respond_to_missing?', $Kernel_respond_to_missing$ques$54 = function(method_name, include_all) {
      var self = this;

      
      
      if (include_all == null) {
        include_all = false;
      };
      return false;
    }, $Kernel_respond_to_missing$ques$54.$$arity = -2);
    
    Opal.def(self, '$require', $Kernel_require$55 = function $$require(file) {
      var self = this;

      
      file = $$($nesting, 'Opal')['$coerce_to!'](file, $$($nesting, 'String'), "to_str");
      return Opal.require(file);
    }, $Kernel_require$55.$$arity = 1);
    
    ;
    
    ;
    Opal.alias(self, "send", "__send__");
    Opal.alias(self, "public_send", "__send__");
    
    Opal.def(self, '$singleton_class', $Kernel_singleton_class$58 = function $$singleton_class() {
      var self = this;

      return Opal.get_singleton_class(self);
    }, $Kernel_singleton_class$58.$$arity = 0);
    
    ;
    
    Opal.def(self, '$srand', $Kernel_srand$60 = function $$srand(seed) {
      var self = this;

      
      
      if (seed == null) {
        seed = $$($nesting, 'Random').$new_seed();
      };
      return $$($nesting, 'Random').$srand(seed);
    }, $Kernel_srand$60.$$arity = -1);
    
    Opal.def(self, '$String', $Kernel_String$61 = function $$String(str) {
      var $a, self = this;

      return ($truthy($a = $$($nesting, 'Opal')['$coerce_to?'](str, $$($nesting, 'String'), "to_str")) ? $a : $$($nesting, 'Opal')['$coerce_to!'](str, $$($nesting, 'String'), "to_s"))
    }, $Kernel_String$61.$$arity = 1);
    
    ;
    
    Opal.def(self, '$to_proc', $Kernel_to_proc$63 = function $$to_proc() {
      var self = this;

      return self
    }, $Kernel_to_proc$63.$$arity = 0);
    
    Opal.def(self, '$to_s', $Kernel_to_s$64 = function $$to_s() {
      var self = this;

      return "" + "#<" + (self.$class()) + ":0x" + (self.$__id__().$to_s(16)) + ">"
    }, $Kernel_to_s$64.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    ;
  })($nesting[0], $nesting);
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Object');

    var $nesting = [self].concat($parent_nesting);

    return self.$include($$($nesting, 'Kernel'))
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/error"] = function(Opal) {
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $send = Opal.send, $truthy = Opal.truthy, $module = Opal.module, $hash2 = Opal.hash2;

  
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Exception');

    var $nesting = [self].concat($parent_nesting), $Exception_new$1, $Exception_exception$2, $Exception_initialize$3, $Exception_backtrace$4, $Exception_exception$5, $Exception_message$6, $Exception_inspect$7, $Exception_set_backtrace$8, $Exception_to_s$9;

    self.$$prototype.message = nil;
    
    var stack_trace_limit;
    Opal.defs(self, '$new', $Exception_new$1 = function($a) {
      var $post_args, args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      
      var message   = (args.length > 0) ? args[0] : nil;
      var error     = new self.$$constructor(message);
      error.name    = self.$$name;
      error.message = message;
      Opal.send(error, error.$initialize, args);

      // Error.captureStackTrace() will use .name and .toString to build the
      // first line of the stack trace so it must be called after the error
      // has been initialized.
      // https://nodejs.org/dist/latest-v6.x/docs/api/errors.html
      if (Opal.config.enable_stack_trace && Error.captureStackTrace) {
        // Passing Kernel.raise will cut the stack trace from that point above
        Error.captureStackTrace(error, stack_trace_limit);
      }

      return error;
    ;
    }, $Exception_new$1.$$arity = -1);
    stack_trace_limit = self.$new;
    Opal.defs(self, '$exception', $Exception_exception$2 = function $$exception($a) {
      var $post_args, args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      return $send(self, 'new', Opal.to_a(args));
    }, $Exception_exception$2.$$arity = -1);
    
    Opal.def(self, '$initialize', $Exception_initialize$3 = function $$initialize($a) {
      var $post_args, args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      return self.message = (args.length > 0) ? args[0] : nil;;
    }, $Exception_initialize$3.$$arity = -1);
    
    ;
    
    Opal.def(self, '$exception', $Exception_exception$5 = function $$exception(str) {
      var self = this;

      
      
      if (str == null) {
        str = nil;
      };
      
      if (str === nil || self === str) {
        return self;
      }

      var cloned = self.$clone();
      cloned.message = str;
      cloned.stack = self.stack;
      return cloned;
    ;
    }, $Exception_exception$5.$$arity = -1);
    
    ;
    
    Opal.def(self, '$inspect', $Exception_inspect$7 = function $$inspect() {
      var self = this, as_str = nil;

      
      as_str = self.$to_s();
      if ($truthy(as_str['$empty?']())) {
        return self.$class().$to_s()
      } else {
        return "" + "#<" + (self.$class().$to_s()) + ": " + (self.$to_s()) + ">"
      };
    }, $Exception_inspect$7.$$arity = 0);
    
    ;
    return (Opal.def(self, '$to_s', $Exception_to_s$9 = function $$to_s() {
      var $a, $b, self = this;

      return ($truthy($a = ($truthy($b = self.message) ? self.message.$to_s() : $b)) ? $a : self.$class().$to_s())
    }, $Exception_to_s$9.$$arity = 0), nil) && 'to_s';
  })($nesting[0], Error, $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'ScriptError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'Exception'), $nesting);
  ;
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'LoadError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'ScriptError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'NotImplementedError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'ScriptError'), $nesting);
  ;
  ;
  ;
  ;
  ;
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'StandardError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'Exception'), $nesting);
  ;
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'ZeroDivisionError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'StandardError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'NameError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'StandardError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'NoMethodError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'NameError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'RuntimeError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'StandardError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'FrozenError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'RuntimeError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'LocalJumpError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'StandardError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'TypeError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'StandardError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'ArgumentError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'StandardError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'IndexError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'StandardError'), $nesting);
  ;
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'KeyError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'IndexError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'RangeError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'StandardError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'FloatDomainError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'RangeError'), $nesting);
  ;
  ;
  ;
  ;
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'NameError');

    var $nesting = [self].concat($parent_nesting), $NameError_initialize$12;

    
    self.$attr_reader("name");
    return (Opal.def(self, '$initialize', $NameError_initialize$12 = function $$initialize(message, name) {
      var $iter = $NameError_initialize$12.$$p, $yield = $iter || nil, self = this;

      if ($iter) $NameError_initialize$12.$$p = null;
      
      
      if (name == null) {
        name = nil;
      };
      $send(self, Opal.find_super_dispatcher(self, 'initialize', $NameError_initialize$12, false), [message], null);
      return (self.name = name);
    }, $NameError_initialize$12.$$arity = -2), nil) && 'initialize';
  })($nesting[0], null, $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'NoMethodError');

    var $nesting = [self].concat($parent_nesting), $NoMethodError_initialize$13;

    
    self.$attr_reader("args");
    return (Opal.def(self, '$initialize', $NoMethodError_initialize$13 = function $$initialize(message, name, args) {
      var $iter = $NoMethodError_initialize$13.$$p, $yield = $iter || nil, self = this;

      if ($iter) $NoMethodError_initialize$13.$$p = null;
      
      
      if (name == null) {
        name = nil;
      };
      
      if (args == null) {
        args = [];
      };
      $send(self, Opal.find_super_dispatcher(self, 'initialize', $NoMethodError_initialize$13, false), [message, name], null);
      return (self.args = args);
    }, $NoMethodError_initialize$13.$$arity = -2), nil) && 'initialize';
  })($nesting[0], null, $nesting);
  ;
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'KeyError');

    var $nesting = [self].concat($parent_nesting), $KeyError_initialize$14, $KeyError_receiver$15, $KeyError_key$16;

    self.$$prototype.receiver = self.$$prototype.key = nil;
    
    
    Opal.def(self, '$initialize', $KeyError_initialize$14 = function $$initialize(message, $kwargs) {
      var receiver, key, $iter = $KeyError_initialize$14.$$p, $yield = $iter || nil, self = this;

      if ($iter) $KeyError_initialize$14.$$p = null;
      
      
      if ($kwargs == null) {
        $kwargs = $hash2([], {});
      } else if (!$kwargs.$$is_hash) {
        throw Opal.ArgumentError.$new('expected kwargs');
      };
      
      receiver = $kwargs.$$smap["receiver"];
      if (receiver == null) {
        receiver = nil
      };
      
      key = $kwargs.$$smap["key"];
      if (key == null) {
        key = nil
      };
      $send(self, Opal.find_super_dispatcher(self, 'initialize', $KeyError_initialize$14, false), [message], null);
      self.receiver = receiver;
      return (self.key = key);
    }, $KeyError_initialize$14.$$arity = -2);
    
    ;
    return ( nil) && 'key';
  })($nesting[0], null, $nesting);
  return (function($base, $parent_nesting) {
    var self = $module($base, 'JS');

    var $nesting = [self].concat($parent_nesting);

    
  })($nesting[0], $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/constants"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$;

  
  ;
  Opal.const_set($nesting[0], 'RUBY_ENGINE', "opal");
  ;
  ;
  ;
  ;
  ;
  ;
  return ;
};

/* Generated by Opal 1.0.0 */
Opal.modules["opal/base"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$;

  
  self.$require("corelib/runtime");
  self.$require("corelib/helpers");
  self.$require("corelib/module");
  self.$require("corelib/class");
  self.$require("corelib/basic_object");
  self.$require("corelib/kernel");
  self.$require("corelib/error");
  return self.$require("corelib/constants");
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/nil"] = function(Opal) {
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $hash2 = Opal.hash2, $truthy = Opal.truthy;

  
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'NilClass');

    var $nesting = [self].concat($parent_nesting), $NilClass_$excl$2, $NilClass_$$3, $NilClass_$$4, $NilClass_$$5, $NilClass_$eq_eq$6, $NilClass_dup$7, $NilClass_clone$8, $NilClass_inspect$9, $NilClass_nil$ques$10, $NilClass_singleton_class$11, $NilClass_to_a$12, $NilClass_to_h$13, $NilClass_to_i$14, $NilClass_to_s$15, $NilClass_to_c$16, $NilClass_rationalize$17, $NilClass_to_r$18, $NilClass_instance_variables$19;

    
    self.$$prototype.$$meta = self;
    (function(self, $parent_nesting) {
      var $nesting = [self].concat($parent_nesting), $allocate$1;

      
      
      Opal.def(self, '$allocate', $allocate$1 = function $$allocate() {
        var self = this;

        return self.$raise($$($nesting, 'TypeError'), "" + "allocator undefined for " + (self.$name()))
      }, $allocate$1.$$arity = 0);
      
      
      Opal.udef(self, '$' + "new");;
      return nil;;
    })(Opal.get_singleton_class(self), $nesting);
    
    Opal.def(self, '$!', $NilClass_$excl$2 = function() {
      var self = this;

      return true
    }, $NilClass_$excl$2.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$==', $NilClass_$eq_eq$6 = function(other) {
      var self = this;

      return other === nil;
    }, $NilClass_$eq_eq$6.$$arity = 1);
    
    Opal.def(self, '$dup', $NilClass_dup$7 = function $$dup() {
      var self = this;

      return nil
    }, $NilClass_dup$7.$$arity = 0);
    
    Opal.def(self, '$clone', $NilClass_clone$8 = function $$clone($kwargs) {
      var freeze, self = this;

      
      
      if ($kwargs == null) {
        $kwargs = $hash2([], {});
      } else if (!$kwargs.$$is_hash) {
        throw Opal.ArgumentError.$new('expected kwargs');
      };
      
      freeze = $kwargs.$$smap["freeze"];
      if (freeze == null) {
        freeze = true
      };
      return nil;
    }, $NilClass_clone$8.$$arity = -1);
    
    Opal.def(self, '$inspect', $NilClass_inspect$9 = function $$inspect() {
      var self = this;

      return "nil"
    }, $NilClass_inspect$9.$$arity = 0);
    
    Opal.def(self, '$nil?', $NilClass_nil$ques$10 = function() {
      var self = this;

      return true
    }, $NilClass_nil$ques$10.$$arity = 0);
    
    Opal.def(self, '$singleton_class', $NilClass_singleton_class$11 = function $$singleton_class() {
      var self = this;

      return $$($nesting, 'NilClass')
    }, $NilClass_singleton_class$11.$$arity = 0);
    
    Opal.def(self, '$to_a', $NilClass_to_a$12 = function $$to_a() {
      var self = this;

      return []
    }, $NilClass_to_a$12.$$arity = 0);
    
    ;
    
    Opal.def(self, '$to_i', $NilClass_to_i$14 = function $$to_i() {
      var self = this;

      return 0
    }, $NilClass_to_i$14.$$arity = 0);
    Opal.alias(self, "to_f", "to_i");
    
    Opal.def(self, '$to_s', $NilClass_to_s$15 = function $$to_s() {
      var self = this;

      return ""
    }, $NilClass_to_s$15.$$arity = 0);
    
    ;
    
    Opal.def(self, '$rationalize', $NilClass_rationalize$17 = function $$rationalize($a) {
      var $post_args, args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      if ($truthy($rb_gt(args.$length(), 1))) {
        self.$raise($$($nesting, 'ArgumentError'))};
      return self.$Rational(0, 1);
    }, $NilClass_rationalize$17.$$arity = -1);
    
    Opal.def(self, '$to_r', $NilClass_to_r$18 = function $$to_r() {
      var self = this;

      return self.$Rational(0, 1)
    }, $NilClass_to_r$18.$$arity = 0);
    return ( nil) && 'instance_variables';
  })($nesting[0], null, $nesting);
  return ;
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/boolean"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $hash2 = Opal.hash2;

  
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Boolean');

    var $nesting = [self].concat($parent_nesting), $Boolean___id__$2, $Boolean_$excl$3, $Boolean_$$4, $Boolean_$$5, $Boolean_$$6, $Boolean_$eq_eq$7, $Boolean_singleton_class$8, $Boolean_to_s$9, $Boolean_dup$10, $Boolean_clone$11;

    
    Opal.defineProperty(self.$$prototype, '$$is_boolean', true);
    Opal.defineProperty(self.$$prototype, '$$meta', self);
    (function(self, $parent_nesting) {
      var $nesting = [self].concat($parent_nesting), $allocate$1;

      
      
      Opal.def(self, '$allocate', $allocate$1 = function $$allocate() {
        var self = this;

        return self.$raise($$($nesting, 'TypeError'), "" + "allocator undefined for " + (self.$name()))
      }, $allocate$1.$$arity = 0);
      
      
      Opal.udef(self, '$' + "new");;
      return nil;;
    })(Opal.get_singleton_class(self), $nesting);
    
    Opal.def(self, '$__id__', $Boolean___id__$2 = function $$__id__() {
      var self = this;

      return self.valueOf() ? 2 : 0;
    }, $Boolean___id__$2.$$arity = 0);
    Opal.alias(self, "object_id", "__id__");
    
    Opal.def(self, '$!', $Boolean_$excl$3 = function() {
      var self = this;

      return self != true;
    }, $Boolean_$excl$3.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$==', $Boolean_$eq_eq$7 = function(other) {
      var self = this;

      return (self == true) === other.valueOf();
    }, $Boolean_$eq_eq$7.$$arity = 1);
    Opal.alias(self, "equal?", "==");
    Opal.alias(self, "eql?", "==");
    
    Opal.def(self, '$singleton_class', $Boolean_singleton_class$8 = function $$singleton_class() {
      var self = this;

      return $$($nesting, 'Boolean')
    }, $Boolean_singleton_class$8.$$arity = 0);
    
    Opal.def(self, '$to_s', $Boolean_to_s$9 = function $$to_s() {
      var self = this;

      return (self == true) ? 'true' : 'false';
    }, $Boolean_to_s$9.$$arity = 0);
    
    Opal.def(self, '$dup', $Boolean_dup$10 = function $$dup() {
      var self = this;

      return self
    }, $Boolean_dup$10.$$arity = 0);
    return (Opal.def(self, '$clone', $Boolean_clone$11 = function $$clone($kwargs) {
      var freeze, self = this;

      
      
      if ($kwargs == null) {
        $kwargs = $hash2([], {});
      } else if (!$kwargs.$$is_hash) {
        throw Opal.ArgumentError.$new('expected kwargs');
      };
      
      freeze = $kwargs.$$smap["freeze"];
      if (freeze == null) {
        freeze = true
      };
      return self;
    }, $Boolean_clone$11.$$arity = -1), nil) && 'clone';
  })($nesting[0], Boolean, $nesting);
  ;
  ;
  ;
  return ;
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/comparable"] = function(Opal) {
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $module = Opal.module, $truthy = Opal.truthy;

  return (function($base, $parent_nesting) {
    var self = $module($base, 'Comparable');

    var $nesting = [self].concat($parent_nesting), $Comparable_$eq_eq$1, $Comparable_$gt$2, $Comparable_$gt_eq$3, $Comparable_$lt$4, $Comparable_$lt_eq$5, $Comparable_between$ques$6, $Comparable_clamp$7, $case = nil;

    
    
    function normalize(what) {
      if (Opal.is_a(what, Opal.Integer)) { return what; }

      if ($rb_gt(what, 0)) { return 1; }
      if ($rb_lt(what, 0)) { return -1; }
      return 0;
    }

    function fail_comparison(lhs, rhs) {
      var class_name;
      (function() {$case = rhs;
    if (nil['$===']($case) || true['$===']($case) || false['$===']($case) || $$($nesting, 'Integer')['$===']($case) || $$($nesting, 'Float')['$===']($case)) {return class_name = rhs.$inspect();}
    else {return class_name = rhs.$$class;}})()
      self.$raise($$($nesting, 'ArgumentError'), "" + "comparison of " + ((lhs).$class()) + " with " + (class_name) + " failed")
    }
  ;
    
    Opal.def(self, '$==', $Comparable_$eq_eq$1 = function(other) {
      var self = this, cmp = nil;

      
      if ($truthy(self['$equal?'](other))) {
        return true};
      
      if (self["$<=>"] == Opal.Kernel["$<=>"]) {
        return false;
      }

      // check for infinite recursion
      if (self.$$comparable) {
        delete self.$$comparable;
        return false;
      }
    ;
      if ($truthy((cmp = self['$<=>'](other)))) {
      } else {
        return false
      };
      return normalize(cmp) == 0;;
    }, $Comparable_$eq_eq$1.$$arity = 1);
    
    Opal.def(self, '$>', $Comparable_$gt$2 = function(other) {
      var self = this, cmp = nil;

      
      if ($truthy((cmp = self['$<=>'](other)))) {
      } else {
        fail_comparison(self, other)
      };
      return normalize(cmp) > 0;;
    }, $Comparable_$gt$2.$$arity = 1);
    
    Opal.def(self, '$>=', $Comparable_$gt_eq$3 = function(other) {
      var self = this, cmp = nil;

      
      if ($truthy((cmp = self['$<=>'](other)))) {
      } else {
        fail_comparison(self, other)
      };
      return normalize(cmp) >= 0;;
    }, $Comparable_$gt_eq$3.$$arity = 1);
    
    Opal.def(self, '$<', $Comparable_$lt$4 = function(other) {
      var self = this, cmp = nil;

      
      if ($truthy((cmp = self['$<=>'](other)))) {
      } else {
        fail_comparison(self, other)
      };
      return normalize(cmp) < 0;;
    }, $Comparable_$lt$4.$$arity = 1);
    
    Opal.def(self, '$<=', $Comparable_$lt_eq$5 = function(other) {
      var self = this, cmp = nil;

      
      if ($truthy((cmp = self['$<=>'](other)))) {
      } else {
        fail_comparison(self, other)
      };
      return normalize(cmp) <= 0;;
    }, $Comparable_$lt_eq$5.$$arity = 1);
    
    ;
    
    ;
  })($nesting[0], $nesting)
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/regexp"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $send = Opal.send, $truthy = Opal.truthy, $gvars = Opal.gvars;

  
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'RegexpError');

    var $nesting = [self].concat($parent_nesting);

    return nil
  })($nesting[0], $$($nesting, 'StandardError'), $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Regexp');

    var $nesting = [self].concat($parent_nesting), $Regexp_$eq_eq$6, $Regexp_$eq_eq_eq$7, $Regexp_$eq_tilde$8, $Regexp_inspect$9, $Regexp_match$10, $Regexp_match$ques$11, $Regexp_$$12, $Regexp_source$13, $Regexp_options$14, $Regexp_casefold$ques$15;

    
    Opal.const_set($nesting[0], 'IGNORECASE', 1);
    ;
    Opal.const_set($nesting[0], 'MULTILINE', 4);
    Opal.defineProperty(self.$$prototype, '$$is_regexp', true);
    (function(self, $parent_nesting) {
      var $nesting = [self].concat($parent_nesting), $allocate$1, $escape$2, $last_match$3, $union$4, $new$5;

      
      
      Opal.def(self, '$allocate', $allocate$1 = function $$allocate() {
        var $iter = $allocate$1.$$p, $yield = $iter || nil, self = this, allocated = nil, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

        if ($iter) $allocate$1.$$p = null;
        // Prepare super implicit arguments
        for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
          $zuper[$zuper_i] = arguments[$zuper_i];
        }
        
        allocated = $send(self, Opal.find_super_dispatcher(self, 'allocate', $allocate$1, false), $zuper, $iter);
        allocated.uninitialized = true;
        return allocated;
      }, $allocate$1.$$arity = 0);
      
      ;
      
      ;
      ;
      
      ;
      return (Opal.def(self, '$new', $new$5 = function(regexp, options) {
        var self = this;

        
        ;
        
        if (regexp.$$is_regexp) {
          return new RegExp(regexp);
        }

        regexp = $$($nesting, 'Opal')['$coerce_to!'](regexp, $$($nesting, 'String'), "to_str");

        if (regexp.charAt(regexp.length - 1) === '\\' && regexp.charAt(regexp.length - 2) !== '\\') {
          self.$raise($$($nesting, 'RegexpError'), "" + "too short escape sequence: /" + (regexp) + "/")
        }

        if (options === undefined || options['$!']()) {
          return new RegExp(regexp);
        }

        if (options.$$is_number) {
          var temp = '';
          if ($$($nesting, 'IGNORECASE') & options) { temp += 'i'; }
          if ($$($nesting, 'MULTILINE')  & options) { temp += 'm'; }
          options = temp;
        }
        else {
          options = 'i';
        }

        return new RegExp(regexp, options);
      ;
      }, $new$5.$$arity = -2), nil) && 'new';
    })(Opal.get_singleton_class(self), $nesting);
    
    Opal.def(self, '$==', $Regexp_$eq_eq$6 = function(other) {
      var self = this;

      return other instanceof RegExp && self.toString() === other.toString();
    }, $Regexp_$eq_eq$6.$$arity = 1);
    
    Opal.def(self, '$===', $Regexp_$eq_eq_eq$7 = function(string) {
      var self = this;

      return self.$match($$($nesting, 'Opal')['$coerce_to?'](string, $$($nesting, 'String'), "to_str")) !== nil
    }, $Regexp_$eq_eq_eq$7.$$arity = 1);
    
    Opal.def(self, '$=~', $Regexp_$eq_tilde$8 = function(string) {
      var $a, self = this;
      if ($gvars["~"] == null) $gvars["~"] = nil;

      return ($truthy($a = self.$match(string)) ? $gvars["~"].$begin(0) : $a)
    }, $Regexp_$eq_tilde$8.$$arity = 1);
    Opal.alias(self, "eql?", "==");
    
    Opal.def(self, '$inspect', $Regexp_inspect$9 = function $$inspect() {
      var self = this;

      
      var regexp_format = /^\/(.*)\/([^\/]*)$/;
      var value = self.toString();
      var matches = regexp_format.exec(value);
      if (matches) {
        var regexp_pattern = matches[1];
        var regexp_flags = matches[2];
        var chars = regexp_pattern.split('');
        var chars_length = chars.length;
        var char_escaped = false;
        var regexp_pattern_escaped = '';
        for (var i = 0; i < chars_length; i++) {
          var current_char = chars[i];
          if (!char_escaped && current_char == '/') {
            regexp_pattern_escaped = regexp_pattern_escaped.concat('\\');
          }
          regexp_pattern_escaped = regexp_pattern_escaped.concat(current_char);
          if (current_char == '\\') {
            if (char_escaped) {
              // does not over escape
              char_escaped = false;
            } else {
              char_escaped = true;
            }
          } else {
            char_escaped = false;
          }
        }
        return '/' + regexp_pattern_escaped + '/' + regexp_flags;
      } else {
        return value;
      }
    
    }, $Regexp_inspect$9.$$arity = 0);
    
    Opal.def(self, '$match', $Regexp_match$10 = function $$match(string, pos) {
      var $iter = $Regexp_match$10.$$p, block = $iter || nil, self = this;
      if ($gvars["~"] == null) $gvars["~"] = nil;

      if ($iter) $Regexp_match$10.$$p = null;
      
      
      if ($iter) $Regexp_match$10.$$p = null;;
      ;
      
      if (self.uninitialized) {
        self.$raise($$($nesting, 'TypeError'), "uninitialized Regexp")
      }

      if (pos === undefined) {
        if (string === nil) return ($gvars["~"] = nil);
        var m = self.exec($$($nesting, 'Opal').$coerce_to(string, $$($nesting, 'String'), "to_str"));
        if (m) {
          ($gvars["~"] = $$($nesting, 'MatchData').$new(self, m));
          return block === nil ? $gvars["~"] : Opal.yield1(block, $gvars["~"]);
        } else {
          return ($gvars["~"] = nil);
        }
      }

      pos = $$($nesting, 'Opal').$coerce_to(pos, $$($nesting, 'Integer'), "to_int");

      if (string === nil) {
        return ($gvars["~"] = nil);
      }

      string = $$($nesting, 'Opal').$coerce_to(string, $$($nesting, 'String'), "to_str");

      if (pos < 0) {
        pos += string.length;
        if (pos < 0) {
          return ($gvars["~"] = nil);
        }
      }

      // global RegExp maintains state, so not using self/this
      var md, re = Opal.global_regexp(self);

      while (true) {
        md = re.exec(string);
        if (md === null) {
          return ($gvars["~"] = nil);
        }
        if (md.index >= pos) {
          ($gvars["~"] = $$($nesting, 'MatchData').$new(re, md));
          return block === nil ? $gvars["~"] : Opal.yield1(block, $gvars["~"]);
        }
        re.lastIndex = md.index + 1;
      }
    ;
    }, $Regexp_match$10.$$arity = -2);
    
    Opal.def(self, '$match?', $Regexp_match$ques$11 = function(string, pos) {
      var self = this;

      
      ;
      
      if (self.uninitialized) {
        self.$raise($$($nesting, 'TypeError'), "uninitialized Regexp")
      }

      if (pos === undefined) {
        return string === nil ? false : self.test($$($nesting, 'Opal').$coerce_to(string, $$($nesting, 'String'), "to_str"));
      }

      pos = $$($nesting, 'Opal').$coerce_to(pos, $$($nesting, 'Integer'), "to_int");

      if (string === nil) {
        return false;
      }

      string = $$($nesting, 'Opal').$coerce_to(string, $$($nesting, 'String'), "to_str");

      if (pos < 0) {
        pos += string.length;
        if (pos < 0) {
          return false;
        }
      }

      // global RegExp maintains state, so not using self/this
      var md, re = Opal.global_regexp(self);

      md = re.exec(string);
      if (md === null || md.index < pos) {
        return false;
      } else {
        return true;
      }
    ;
    }, $Regexp_match$ques$11.$$arity = -2);
    
    ;
    
    Opal.def(self, '$source', $Regexp_source$13 = function $$source() {
      var self = this;

      return self.source;
    }, $Regexp_source$13.$$arity = 0);
    
    ;
    
    ;
    return Opal.alias(self, "to_s", "source");
  })($nesting[0], RegExp, $nesting);
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'MatchData');

    var $nesting = [self].concat($parent_nesting), $MatchData_initialize$16, $MatchData_$$$17, $MatchData_offset$18, $MatchData_$eq_eq$19, $MatchData_begin$20, $MatchData_end$21, $MatchData_captures$22, $MatchData_inspect$23, $MatchData_length$24, $MatchData_to_a$25, $MatchData_to_s$26, $MatchData_values_at$27;

    self.$$prototype.matches = nil;
    
    self.$attr_reader("post_match", "pre_match", "regexp", "string");
    
    Opal.def(self, '$initialize', $MatchData_initialize$16 = function $$initialize(regexp, match_groups) {
      var self = this;

      
      $gvars["~"] = self;
      self.regexp = regexp;
      self.begin = match_groups.index;
      self.string = match_groups.input;
      self.pre_match = match_groups.input.slice(0, match_groups.index);
      self.post_match = match_groups.input.slice(match_groups.index + match_groups[0].length);
      self.matches = [];
      
      for (var i = 0, length = match_groups.length; i < length; i++) {
        var group = match_groups[i];

        if (group == null) {
          self.matches.push(nil);
        }
        else {
          self.matches.push(group);
        }
      }
    ;
    }, $MatchData_initialize$16.$$arity = 2);
    
    Opal.def(self, '$[]', $MatchData_$$$17 = function($a) {
      var $post_args, args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      return $send(self.matches, '[]', Opal.to_a(args));
    }, $MatchData_$$$17.$$arity = -1);
    
    ;
    
    Opal.def(self, '$==', $MatchData_$eq_eq$19 = function(other) {
      var $a, $b, $c, $d, self = this;

      
      if ($truthy($$($nesting, 'MatchData')['$==='](other))) {
      } else {
        return false
      };
      return ($truthy($a = ($truthy($b = ($truthy($c = ($truthy($d = self.string == other.string) ? self.regexp.toString() == other.regexp.toString() : $d)) ? self.pre_match == other.pre_match : $c)) ? self.post_match == other.post_match : $b)) ? self.begin == other.begin : $a);
    }, $MatchData_$eq_eq$19.$$arity = 1);
    Opal.alias(self, "eql?", "==");
    
    Opal.def(self, '$begin', $MatchData_begin$20 = function $$begin(n) {
      var self = this;

      
      if (n !== 0) {
        self.$raise($$($nesting, 'ArgumentError'), "MatchData#begin only supports 0th element")
      }
      return self.begin;
    
    }, $MatchData_begin$20.$$arity = 1);
    
    Opal.def(self, '$end', $MatchData_end$21 = function $$end(n) {
      var self = this;

      
      if (n !== 0) {
        self.$raise($$($nesting, 'ArgumentError'), "MatchData#end only supports 0th element")
      }
      return self.begin + self.matches[n].length;
    
    }, $MatchData_end$21.$$arity = 1);
    
    ;
    
    Opal.def(self, '$inspect', $MatchData_inspect$23 = function $$inspect() {
      var self = this;

      
      var str = "#<MatchData " + (self.matches[0]).$inspect();

      for (var i = 1, length = self.matches.length; i < length; i++) {
        str += " " + i + ":" + (self.matches[i]).$inspect();
      }

      return str + ">";
    
    }, $MatchData_inspect$23.$$arity = 0);
    
    Opal.def(self, '$length', $MatchData_length$24 = function $$length() {
      var self = this;

      return self.matches.length
    }, $MatchData_length$24.$$arity = 0);
    Opal.alias(self, "size", "length");
    
    Opal.def(self, '$to_a', $MatchData_to_a$25 = function $$to_a() {
      var self = this;

      return self.matches
    }, $MatchData_to_a$25.$$arity = 0);
    
    Opal.def(self, '$to_s', $MatchData_to_s$26 = function $$to_s() {
      var self = this;

      return self.matches[0]
    }, $MatchData_to_s$26.$$arity = 0);
    return ( nil) && 'values_at';
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/string"] = function(Opal) {
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $send = Opal.send, $gvars = Opal.gvars;

  
  self.$require("corelib/comparable");
  self.$require("corelib/regexp");
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'String');

    var $nesting = [self].concat($parent_nesting), $String___id__$1, $String_try_convert$2, $String_new$3, $String_initialize$4, $String_$percent$5, $String_$$6, $String_$plus$7, $String_$lt_eq_gt$8, $String_$eq_eq$9, $String_$eq_tilde$10, $String_$$$11, $String_b$12, $String_capitalize$13, $String_casecmp$14, $String_casecmp$ques$15, $String_center$16, $String_chars$17, $String_chomp$18, $String_chop$19, $String_chr$20, $String_clone$21, $String_dup$22, $String_count$23, $String_delete$24, $String_delete_prefix$25, $String_delete_suffix$26, $String_downcase$27, $String_each_char$28, $String_each_line$30, $String_empty$ques$31, $String_end_with$ques$32, $String_gsub$33, $String_hash$34, $String_hex$35, $String_include$ques$36, $String_index$37, $String_inspect$38, $String_intern$39, $String_lines$40, $String_length$41, $String_ljust$42, $String_lstrip$43, $String_ascii_only$ques$44, $String_match$45, $String_match$ques$46, $String_next$47, $String_oct$48, $String_ord$49, $String_partition$50, $String_reverse$51, $String_rindex$52, $String_rjust$53, $String_rpartition$54, $String_rstrip$55, $String_scan$56, $String_split$57, $String_squeeze$58, $String_start_with$ques$59, $String_strip$60, $String_sub$61, $String_sum$62, $String_swapcase$63, $String_to_f$64, $String_to_i$65, $String_to_proc$66, $String_to_s$68, $String_tr$69, $String_tr_s$70, $String_upcase$71, $String_upto$72, $String_instance_variables$73, $String__load$74, $String_unicode_normalize$75, $String_unicode_normalized$ques$76, $String_unpack$77, $String_unpack1$78;

    
    self.$include($$($nesting, 'Comparable'));
    
    Opal.defineProperty(self.$$prototype, '$$is_string', true);

    Opal.defineProperty(self.$$prototype, '$$cast', function(string) {
      var klass = this.$$class;
      if (klass.$$constructor === String) {
        return string;
      } else {
        return new klass.$$constructor(string);
      }
    });
  ;
    
    Opal.def(self, '$__id__', $String___id__$1 = function $$__id__() {
      var self = this;

      return self.toString();
    }, $String___id__$1.$$arity = 0);
    Opal.alias(self, "object_id", "__id__");
    ;
    Opal.defs(self, '$new', $String_new$3 = function(str) {
      var self = this;

      
      
      if (str == null) {
        str = "";
      };
      str = $$($nesting, 'Opal').$coerce_to(str, $$($nesting, 'String'), "to_str");
      return new self.$$constructor(str);;
    }, $String_new$3.$$arity = -1);
    
    Opal.def(self, '$initialize', $String_initialize$4 = function $$initialize(str) {
      var self = this;

      
      ;
      
      if (str === undefined) {
        return self;
      }
    ;
      return self.$raise($$($nesting, 'NotImplementedError'), "Mutable strings are not supported in Opal.");
    }, $String_initialize$4.$$arity = -1);
    
    Opal.def(self, '$%', $String_$percent$5 = function(data) {
      var self = this;

      if ($truthy($$($nesting, 'Array')['$==='](data))) {
        return $send(self, 'format', [self].concat(Opal.to_a(data)))
      } else {
        return self.$format(self, data)
      }
    }, $String_$percent$5.$$arity = 1);
    
    Opal.def(self, '$*', $String_$$6 = function(count) {
      var self = this;

      
      count = $$($nesting, 'Opal').$coerce_to(count, $$($nesting, 'Integer'), "to_int");

      if (count < 0) {
        self.$raise($$($nesting, 'ArgumentError'), "negative argument")
      }

      if (count === 0) {
        return self.$$cast('');
      }

      var result = '',
          string = self.toString();

      // All credit for the bit-twiddling magic code below goes to Mozilla
      // polyfill implementation of String.prototype.repeat() posted here:
      // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/repeat

      if (string.length * count >= 1 << 28) {
        self.$raise($$($nesting, 'RangeError'), "multiply count must not overflow maximum string size")
      }

      for (;;) {
        if ((count & 1) === 1) {
          result += string;
        }
        count >>>= 1;
        if (count === 0) {
          break;
        }
        string += string;
      }

      return self.$$cast(result);
    
    }, $String_$$6.$$arity = 1);
    
    Opal.def(self, '$+', $String_$plus$7 = function(other) {
      var self = this;

      
      other = $$($nesting, 'Opal').$coerce_to(other, $$($nesting, 'String'), "to_str");
      return self + other.$to_s();
    }, $String_$plus$7.$$arity = 1);
    
    Opal.def(self, '$<=>', $String_$lt_eq_gt$8 = function(other) {
      var self = this;

      if ($truthy(other['$respond_to?']("to_str"))) {
        
        other = other.$to_str().$to_s();
        return self > other ? 1 : (self < other ? -1 : 0);;
      } else {
        
        var cmp = other['$<=>'](self);

        if (cmp === nil) {
          return nil;
        }
        else {
          return cmp > 0 ? -1 : (cmp < 0 ? 1 : 0);
        }
      
      }
    }, $String_$lt_eq_gt$8.$$arity = 1);
    
    Opal.def(self, '$==', $String_$eq_eq$9 = function(other) {
      var self = this;

      
      if (other.$$is_string) {
        return self.toString() === other.toString();
      }
      if ($$($nesting, 'Opal')['$respond_to?'](other, "to_str")) {
        return other['$=='](self);
      }
      return false;
    
    }, $String_$eq_eq$9.$$arity = 1);
    Opal.alias(self, "eql?", "==");
    Opal.alias(self, "===", "==");
    
    Opal.def(self, '$=~', $String_$eq_tilde$10 = function(other) {
      var self = this;

      
      if (other.$$is_string) {
        self.$raise($$($nesting, 'TypeError'), "type mismatch: String given");
      }

      return other['$=~'](self);
    
    }, $String_$eq_tilde$10.$$arity = 1);
    
    Opal.def(self, '$[]', $String_$$$11 = function(index, length) {
      var self = this;

      
      ;
      
      var size = self.length, exclude;

      if (index.$$is_range) {
        exclude = index.excl;
        length  = $$($nesting, 'Opal').$coerce_to(index.end, $$($nesting, 'Integer'), "to_int");
        index   = $$($nesting, 'Opal').$coerce_to(index.begin, $$($nesting, 'Integer'), "to_int");

        if (Math.abs(index) > size) {
          return nil;
        }

        if (index < 0) {
          index += size;
        }

        if (length < 0) {
          length += size;
        }

        if (!exclude) {
          length += 1;
        }

        length = length - index;

        if (length < 0) {
          length = 0;
        }

        return self.$$cast(self.substr(index, length));
      }


      if (index.$$is_string) {
        if (length != null) {
          self.$raise($$($nesting, 'TypeError'))
        }
        return self.indexOf(index) !== -1 ? self.$$cast(index) : nil;
      }


      if (index.$$is_regexp) {
        var match = self.match(index);

        if (match === null) {
          ($gvars["~"] = nil)
          return nil;
        }

        ($gvars["~"] = $$($nesting, 'MatchData').$new(index, match))

        if (length == null) {
          return self.$$cast(match[0]);
        }

        length = $$($nesting, 'Opal').$coerce_to(length, $$($nesting, 'Integer'), "to_int");

        if (length < 0 && -length < match.length) {
          return self.$$cast(match[length += match.length]);
        }

        if (length >= 0 && length < match.length) {
          return self.$$cast(match[length]);
        }

        return nil;
      }


      index = $$($nesting, 'Opal').$coerce_to(index, $$($nesting, 'Integer'), "to_int");

      if (index < 0) {
        index += size;
      }

      if (length == null) {
        if (index >= size || index < 0) {
          return nil;
        }
        return self.$$cast(self.substr(index, 1));
      }

      length = $$($nesting, 'Opal').$coerce_to(length, $$($nesting, 'Integer'), "to_int");

      if (length < 0) {
        return nil;
      }

      if (index > size || index < 0) {
        return nil;
      }

      return self.$$cast(self.substr(index, length));
    ;
    }, $String_$$$11.$$arity = -2);
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$chomp', $String_chomp$18 = function $$chomp(separator) {
      var self = this;
      if ($gvars["/"] == null) $gvars["/"] = nil;

      
      
      if (separator == null) {
        separator = $gvars["/"];
      };
      if ($truthy(separator === nil || self.length === 0)) {
        return self};
      separator = $$($nesting, 'Opal')['$coerce_to!'](separator, $$($nesting, 'String'), "to_str").$to_s();
      
      var result;

      if (separator === "\n") {
        result = self.replace(/\r?\n?$/, '');
      }
      else if (separator === "") {
        result = self.replace(/(\r?\n)+$/, '');
      }
      else if (self.length >= separator.length) {
        var tail = self.substr(self.length - separator.length, separator.length);

        if (tail === separator) {
          result = self.substr(0, self.length - separator.length);
        }
      }

      if (result != null) {
        return self.$$cast(result);
      }
    ;
      return self;
    }, $String_chomp$18.$$arity = -1);
    
    ;
    
    Opal.def(self, '$chr', $String_chr$20 = function $$chr() {
      var self = this;

      return self.charAt(0);
    }, $String_chr$20.$$arity = 0);
    
    Opal.def(self, '$clone', $String_clone$21 = function $$clone() {
      var self = this, copy = nil;

      
      copy = new String(self);
      copy.$copy_singleton_methods(self);
      copy.$initialize_clone(self);
      return copy;
    }, $String_clone$21.$$arity = 0);
    
    Opal.def(self, '$dup', $String_dup$22 = function $$dup() {
      var self = this, copy = nil;

      
      copy = new String(self);
      copy.$initialize_dup(self);
      return copy;
    }, $String_dup$22.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$empty?', $String_empty$ques$31 = function() {
      var self = this;

      return self.length === 0;
    }, $String_empty$ques$31.$$arity = 0);
    
    ;
    Opal.alias(self, "equal?", "===");
    
    ;
    
    Opal.def(self, '$hash', $String_hash$34 = function $$hash() {
      var self = this;

      return self.toString();
    }, $String_hash$34.$$arity = 0);
    
    ;
    
    Opal.def(self, '$include?', $String_include$ques$36 = function(other) {
      var self = this;

      
      if (!other.$$is_string) {
        (other = $$($nesting, 'Opal').$coerce_to(other, $$($nesting, 'String'), "to_str"))
      }
      return self.indexOf(other) !== -1;
    
    }, $String_include$ques$36.$$arity = 1);
    
    ;
    
    Opal.def(self, '$inspect', $String_inspect$38 = function $$inspect() {
      var self = this;

      
      var escapable = /[\\\"\x00-\x1f\u007F-\u009F\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
          meta = {
            '\u0007': '\\a',
            '\u001b': '\\e',
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '\v': '\\v',
            '"' : '\\"',
            '\\': '\\\\'
          },
          escaped = self.replace(escapable, function (chr) {
            return meta[chr] || '\\u' + ('0000' + chr.charCodeAt(0).toString(16).toUpperCase()).slice(-4);
          });
      return '"' + escaped.replace(/\#[\$\@\{]/g, '\\$&') + '"';
    
    }, $String_inspect$38.$$arity = 0);
    
    Opal.def(self, '$intern', $String_intern$39 = function $$intern() {
      var self = this;

      return self.toString();
    }, $String_intern$39.$$arity = 0);
    
    ;
    
    Opal.def(self, '$length', $String_length$41 = function $$length() {
      var self = this;

      return self.length;
    }, $String_length$41.$$arity = 0);
    
    Opal.def(self, '$ljust', $String_ljust$42 = function $$ljust(width, padstr) {
      var self = this;

      
      
      if (padstr == null) {
        padstr = " ";
      };
      width = $$($nesting, 'Opal').$coerce_to(width, $$($nesting, 'Integer'), "to_int");
      padstr = $$($nesting, 'Opal').$coerce_to(padstr, $$($nesting, 'String'), "to_str").$to_s();
      if ($truthy(padstr['$empty?']())) {
        self.$raise($$($nesting, 'ArgumentError'), "zero width padding")};
      if ($truthy(width <= self.length)) {
        return self};
      
      var index  = -1,
          result = "";

      width -= self.length;

      while (++index < width) {
        result += padstr;
      }

      return self.$$cast(self + result.slice(0, width));
    ;
    }, $String_ljust$42.$$arity = -2);
    
    ;
    
    ;
    
    Opal.def(self, '$match', $String_match$45 = function $$match(pattern, pos) {
      var $iter = $String_match$45.$$p, block = $iter || nil, $a, self = this;

      if ($iter) $String_match$45.$$p = null;
      
      
      if ($iter) $String_match$45.$$p = null;;
      ;
      if ($truthy(($truthy($a = $$($nesting, 'String')['$==='](pattern)) ? $a : pattern['$respond_to?']("to_str")))) {
        pattern = $$($nesting, 'Regexp').$new(pattern.$to_str())};
      if ($truthy($$($nesting, 'Regexp')['$==='](pattern))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "" + "wrong argument type " + (pattern.$class()) + " (expected Regexp)")
      };
      return $send(pattern, 'match', [self, pos], block.$to_proc());
    }, $String_match$45.$$arity = -2);
    
    Opal.def(self, '$match?', $String_match$ques$46 = function(pattern, pos) {
      var $a, self = this;

      
      ;
      if ($truthy(($truthy($a = $$($nesting, 'String')['$==='](pattern)) ? $a : pattern['$respond_to?']("to_str")))) {
        pattern = $$($nesting, 'Regexp').$new(pattern.$to_str())};
      if ($truthy($$($nesting, 'Regexp')['$==='](pattern))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "" + "wrong argument type " + (pattern.$class()) + " (expected Regexp)")
      };
      return pattern['$match?'](self, pos);
    }, $String_match$ques$46.$$arity = -2);
    
    Opal.def(self, '$next', $String_next$47 = function $$next() {
      var self = this;

      
      var i = self.length;
      if (i === 0) {
        return self.$$cast('');
      }
      var result = self;
      var first_alphanum_char_index = self.search(/[a-zA-Z0-9]/);
      var carry = false;
      var code;
      while (i--) {
        code = self.charCodeAt(i);
        if ((code >= 48 && code <= 57) ||
          (code >= 65 && code <= 90) ||
          (code >= 97 && code <= 122)) {
          switch (code) {
          case 57:
            carry = true;
            code = 48;
            break;
          case 90:
            carry = true;
            code = 65;
            break;
          case 122:
            carry = true;
            code = 97;
            break;
          default:
            carry = false;
            code += 1;
          }
        } else {
          if (first_alphanum_char_index === -1) {
            if (code === 255) {
              carry = true;
              code = 0;
            } else {
              carry = false;
              code += 1;
            }
          } else {
            carry = true;
          }
        }
        result = result.slice(0, i) + String.fromCharCode(code) + result.slice(i + 1);
        if (carry && (i === 0 || i === first_alphanum_char_index)) {
          switch (code) {
          case 65:
            break;
          case 97:
            break;
          default:
            code += 1;
          }
          if (i === 0) {
            result = String.fromCharCode(code) + result;
          } else {
            result = result.slice(0, i) + String.fromCharCode(code) + result.slice(i);
          }
          carry = false;
        }
        if (!carry) {
          break;
        }
      }
      return self.$$cast(result);
    
    }, $String_next$47.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$rjust', $String_rjust$53 = function $$rjust(width, padstr) {
      var self = this;

      
      
      if (padstr == null) {
        padstr = " ";
      };
      width = $$($nesting, 'Opal').$coerce_to(width, $$($nesting, 'Integer'), "to_int");
      padstr = $$($nesting, 'Opal').$coerce_to(padstr, $$($nesting, 'String'), "to_str").$to_s();
      if ($truthy(padstr['$empty?']())) {
        self.$raise($$($nesting, 'ArgumentError'), "zero width padding")};
      if ($truthy(width <= self.length)) {
        return self};
      
      var chars     = Math.floor(width - self.length),
          patterns  = Math.floor(chars / padstr.length),
          result    = Array(patterns + 1).join(padstr),
          remaining = chars - result.length;

      return self.$$cast(result + padstr.slice(0, remaining) + self);
    ;
    }, $String_rjust$53.$$arity = -2);
    
    ;
    
    ;
    
    ;
    Opal.alias(self, "size", "length");
    ;
    
    Opal.def(self, '$split', $String_split$57 = function $$split(pattern, limit) {
      var $a, self = this;
      if ($gvars[";"] == null) $gvars[";"] = nil;

      
      ;
      ;
      
      if (self.length === 0) {
        return [];
      }

      if (limit === undefined) {
        limit = 0;
      } else {
        limit = $$($nesting, 'Opal')['$coerce_to!'](limit, $$($nesting, 'Integer'), "to_int");
        if (limit === 1) {
          return [self];
        }
      }

      if (pattern === undefined || pattern === nil) {
        pattern = ($truthy($a = $gvars[";"]) ? $a : " ");
      }

      var result = [],
          string = self.toString(),
          index = 0,
          match,
          i, ii;

      if (pattern.$$is_regexp) {
        pattern = Opal.global_multiline_regexp(pattern);
      } else {
        pattern = $$($nesting, 'Opal').$coerce_to(pattern, $$($nesting, 'String'), "to_str").$to_s();
        if (pattern === ' ') {
          pattern = /\s+/gm;
          string = string.replace(/^\s+/, '');
        } else {
          pattern = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gm');
        }
      }

      result = string.split(pattern);

      if (result.length === 1 && result[0] === string) {
        return [self.$$cast(result[0])];
      }

      while ((i = result.indexOf(undefined)) !== -1) {
        result.splice(i, 1);
      }

      function castResult() {
        for (i = 0; i < result.length; i++) {
          result[i] = self.$$cast(result[i]);
        }
      }

      if (limit === 0) {
        while (result[result.length - 1] === '') {
          result.length -= 1;
        }
        castResult();
        return result;
      }

      match = pattern.exec(string);

      if (limit < 0) {
        if (match !== null && match[0] === '' && pattern.source.indexOf('(?=') === -1) {
          for (i = 0, ii = match.length; i < ii; i++) {
            result.push('');
          }
        }
        castResult();
        return result;
      }

      if (match !== null && match[0] === '') {
        result.splice(limit - 1, result.length - 1, result.slice(limit - 1).join(''));
        castResult();
        return result;
      }

      if (limit >= result.length) {
        castResult();
        return result;
      }

      i = 0;
      while (match !== null) {
        i++;
        index = pattern.lastIndex;
        if (i + 1 === limit) {
          break;
        }
        match = pattern.exec(string);
      }
      result.splice(limit - 1, result.length - 1, string.slice(index));
      castResult();
      return result;
    ;
    }, $String_split$57.$$arity = -1);
    
    ;
    
    Opal.def(self, '$start_with?', $String_start_with$ques$59 = function($a) {
      var $post_args, prefixes, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      prefixes = $post_args;;
      
      for (var i = 0, length = prefixes.length; i < length; i++) {
        var prefix = $$($nesting, 'Opal').$coerce_to(prefixes[i], $$($nesting, 'String'), "to_str").$to_s();

        if (self.indexOf(prefix) === 0) {
          return true;
        }
      }

      return false;
    ;
    }, $String_start_with$ques$59.$$arity = -1);
    
    ;
    
    Opal.def(self, '$sub', $String_sub$61 = function $$sub(pattern, replacement) {
      var $iter = $String_sub$61.$$p, block = $iter || nil, self = this;

      if ($iter) $String_sub$61.$$p = null;
      
      
      if ($iter) $String_sub$61.$$p = null;;
      ;
      
      if (!pattern.$$is_regexp) {
        pattern = $$($nesting, 'Opal').$coerce_to(pattern, $$($nesting, 'String'), "to_str");
        pattern = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }

      var result, match = pattern.exec(self);

      if (match === null) {
        ($gvars["~"] = nil)
        result = self.toString();
      } else {
        $$($nesting, 'MatchData').$new(pattern, match)

        if (replacement === undefined) {

          if (block === nil) {
            self.$raise($$($nesting, 'ArgumentError'), "wrong number of arguments (1 for 2)")
          }
          result = self.slice(0, match.index) + block(match[0]) + self.slice(match.index + match[0].length);

        } else if (replacement.$$is_hash) {

          result = self.slice(0, match.index) + (replacement)['$[]'](match[0]).$to_s() + self.slice(match.index + match[0].length);

        } else {

          replacement = $$($nesting, 'Opal').$coerce_to(replacement, $$($nesting, 'String'), "to_str");

          replacement = replacement.replace(/([\\]+)([0-9+&`'])/g, function (original, slashes, command) {
            if (slashes.length % 2 === 0) {
              return original;
            }
            switch (command) {
            case "+":
              for (var i = match.length - 1; i > 0; i--) {
                if (match[i] !== undefined) {
                  return slashes.slice(1) + match[i];
                }
              }
              return '';
            case "&": return slashes.slice(1) + match[0];
            case "`": return slashes.slice(1) + self.slice(0, match.index);
            case "'": return slashes.slice(1) + self.slice(match.index + match[0].length);
            default:  return slashes.slice(1) + (match[command] || '');
            }
          }).replace(/\\\\/g, '\\');

          result = self.slice(0, match.index) + replacement + self.slice(match.index + match[0].length);
        }
      }

      return self.$$cast(result);
    ;
    }, $String_sub$61.$$arity = -2);
    Opal.alias(self, "succ", "next");
    
    ;
    
    ;
    
    Opal.def(self, '$to_f', $String_to_f$64 = function $$to_f() {
      var self = this;

      
      if (self.charAt(0) === '_') {
        return 0;
      }

      var result = parseFloat(self.replace(/_/g, ''));

      if (isNaN(result) || result == Infinity || result == -Infinity) {
        return 0;
      }
      else {
        return result;
      }
    
    }, $String_to_f$64.$$arity = 0);
    
    Opal.def(self, '$to_i', $String_to_i$65 = function $$to_i(base) {
      var self = this;

      
      
      if (base == null) {
        base = 10;
      };
      
      var result,
          string = self.toLowerCase(),
          radix = $$($nesting, 'Opal').$coerce_to(base, $$($nesting, 'Integer'), "to_int");

      if (radix === 1 || radix < 0 || radix > 36) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "invalid radix " + (radix))
      }

      if (/^\s*_/.test(string)) {
        return 0;
      }

      string = string.replace(/^(\s*[+-]?)(0[bodx]?)(.+)$/, function (original, head, flag, tail) {
        switch (tail.charAt(0)) {
        case '+':
        case '-':
          return original;
        case '0':
          if (tail.charAt(1) === 'x' && flag === '0x' && (radix === 0 || radix === 16)) {
            return original;
          }
        }
        switch (flag) {
        case '0b':
          if (radix === 0 || radix === 2) {
            radix = 2;
            return head + tail;
          }
          break;
        case '0':
        case '0o':
          if (radix === 0 || radix === 8) {
            radix = 8;
            return head + tail;
          }
          break;
        case '0d':
          if (radix === 0 || radix === 10) {
            radix = 10;
            return head + tail;
          }
          break;
        case '0x':
          if (radix === 0 || radix === 16) {
            radix = 16;
            return head + tail;
          }
          break;
        }
        return original
      });

      result = parseInt(string.replace(/_(?!_)/g, ''), radix);
      return isNaN(result) ? 0 : result;
    ;
    }, $String_to_i$65.$$arity = -1);
    
    Opal.def(self, '$to_proc', $String_to_proc$66 = function $$to_proc() {
      var $$67, $iter = $String_to_proc$66.$$p, $yield = $iter || nil, self = this, method_name = nil;

      if ($iter) $String_to_proc$66.$$p = null;
      
      method_name = $rb_plus("$", self.valueOf());
      return $send(self, 'proc', [], ($$67 = function($a){var self = $$67.$$s == null ? this : $$67.$$s, $iter = $$67.$$p, block = $iter || nil, $post_args, args;

      
        
        if ($iter) $$67.$$p = null;;
        
        $post_args = Opal.slice.call(arguments, 0, arguments.length);
        
        args = $post_args;;
        
        if (args.length === 0) {
          self.$raise($$($nesting, 'ArgumentError'), "no receiver given")
        }

        var recv = args[0];

        if (recv == null) recv = nil;

        var body = recv[method_name];

        if (!body) {
          return recv.$method_missing.apply(recv, args);
        }

        if (typeof block === 'function') {
          body.$$p = block;
        }

        if (args.length === 1) {
          return body.call(recv);
        } else {
          return body.apply(recv, args.slice(1));
        }
      ;}, $$67.$$s = self, $$67.$$arity = -1, $$67));
    }, $String_to_proc$66.$$arity = 0);
    
    Opal.def(self, '$to_s', $String_to_s$68 = function $$to_s() {
      var self = this;

      return self.toString();
    }, $String_to_s$68.$$arity = 0);
    Opal.alias(self, "to_str", "to_s");
    Opal.alias(self, "to_sym", "intern");
    
    ;
    
    ;
    
    Opal.def(self, '$upcase', $String_upcase$71 = function $$upcase() {
      var self = this;

      return self.$$cast(self.toUpperCase());
    }, $String_upcase$71.$$arity = 0);
    
    ;
    
   
  ;
    
    ;
    ;
    
    ;
    
    ;
    
    ;
    return ( nil) && 'unpack1';
  })($nesting[0], String, $nesting);
  return Opal.const_set($nesting[0], 'Symbol', $$($nesting, 'String'));
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/enumerable"] = function(Opal) {
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  function $rb_times(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs * rhs : lhs['$*'](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  function $rb_le(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs <= rhs : lhs['$<='](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $module = Opal.module, $truthy = Opal.truthy, $send = Opal.send, $falsy = Opal.falsy, $hash2 = Opal.hash2, $lambda = Opal.lambda;

  return (function($base, $parent_nesting) {
    var self = $module($base, 'Enumerable');

    var $nesting = [self].concat($parent_nesting), $Enumerable_all$ques$1, $Enumerable_any$ques$5, $Enumerable_chunk$9, $Enumerable_chunk_while$12, $Enumerable_collect$14, $Enumerable_collect_concat$16, $Enumerable_count$19, $Enumerable_cycle$23, $Enumerable_detect$25, $Enumerable_drop$27, $Enumerable_drop_while$28, $Enumerable_each_cons$29, $Enumerable_each_entry$31, $Enumerable_each_slice$33, $Enumerable_each_with_index$35, $Enumerable_each_with_object$37, $Enumerable_entries$39, $Enumerable_find_all$40, $Enumerable_find_index$42, $Enumerable_first$45, $Enumerable_grep$48, $Enumerable_grep_v$50, $Enumerable_group_by$52, $Enumerable_include$ques$54, $Enumerable_inject$56, $Enumerable_lazy$57, $Enumerable_enumerator_size$59, $Enumerable_max$60, $Enumerable_max_by$61, $Enumerable_min$63, $Enumerable_min_by$65, $Enumerable_minmax$67, $Enumerable_minmax_by$69, $Enumerable_none$ques$71, $Enumerable_one$ques$75, $Enumerable_partition$79, $Enumerable_reject$81, $Enumerable_reverse_each$83, $Enumerable_slice_before$85, $Enumerable_slice_after$87, $Enumerable_slice_when$90, $Enumerable_sort$92, $Enumerable_sort_by$94, $Enumerable_sum$99, $Enumerable_take$101, $Enumerable_take_while$102, $Enumerable_uniq$104, $Enumerable_to_h$106, $Enumerable_zip$107;

    
    
    function comparableForPattern(value) {
      if (value.length === 0) {
        value = [nil];
      }

      if (value.length > 1) {
        value = [value];
      }

      return value;
    }
  ;
    
    ;
    
    Opal.def(self, '$any?', $Enumerable_any$ques$5 = function(pattern) {try {

      var $iter = $Enumerable_any$ques$5.$$p, block = $iter || nil, $$6, $$7, $$8, self = this;

      if ($iter) $Enumerable_any$ques$5.$$p = null;
      
      
      if ($iter) $Enumerable_any$ques$5.$$p = null;;
      ;
      if ($truthy(pattern !== undefined)) {
        $send(self, 'each', [], ($$6 = function($a){var self = $$6.$$s == null ? this : $$6.$$s, $post_args, value, comparable = nil;

        
          
          $post_args = Opal.slice.call(arguments, 0, arguments.length);
          
          value = $post_args;;
          comparable = comparableForPattern(value);
          if ($truthy($send(pattern, 'public_send', ["==="].concat(Opal.to_a(comparable))))) {
            Opal.ret(true)
          } else {
            return nil
          };}, $$6.$$s = self, $$6.$$arity = -1, $$6))
      } else if ((block !== nil)) {
        $send(self, 'each', [], ($$7 = function($a){var self = $$7.$$s == null ? this : $$7.$$s, $post_args, value;

        
          
          $post_args = Opal.slice.call(arguments, 0, arguments.length);
          
          value = $post_args;;
          if ($truthy(Opal.yieldX(block, Opal.to_a(value)))) {
            Opal.ret(true)
          } else {
            return nil
          };}, $$7.$$s = self, $$7.$$arity = -1, $$7))
      } else {
        $send(self, 'each', [], ($$8 = function($a){var self = $$8.$$s == null ? this : $$8.$$s, $post_args, value;

        
          
          $post_args = Opal.slice.call(arguments, 0, arguments.length);
          
          value = $post_args;;
          if ($truthy($$($nesting, 'Opal').$destructure(value))) {
            Opal.ret(true)
          } else {
            return nil
          };}, $$8.$$s = self, $$8.$$arity = -1, $$8))
      };
      return false;
      } catch ($returner) { if ($returner === Opal.returner) { return $returner.$v } throw $returner; }
    }, $Enumerable_any$ques$5.$$arity = -1);
    
    ;
    
    ;
    
    Opal.def(self, '$collect', $Enumerable_collect$14 = function $$collect() {
      var $iter = $Enumerable_collect$14.$$p, block = $iter || nil, $$15, self = this;

      if ($iter) $Enumerable_collect$14.$$p = null;
      
      
      if ($iter) $Enumerable_collect$14.$$p = null;;
      if ((block !== nil)) {
      } else {
        return $send(self, 'enum_for', ["collect"], ($$15 = function(){var self = $$15.$$s == null ? this : $$15.$$s;

        return self.$enumerator_size()}, $$15.$$s = self, $$15.$$arity = 0, $$15))
      };
      
      var result = [];

      self.$each.$$p = function() {
        var value = Opal.yieldX(block, arguments);

        result.push(value);
      };

      self.$each();

      return result;
    ;
    }, $Enumerable_collect$14.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$detect', $Enumerable_detect$25 = function $$detect(ifnone) {try {

      var $iter = $Enumerable_detect$25.$$p, block = $iter || nil, $$26, self = this;

      if ($iter) $Enumerable_detect$25.$$p = null;
      
      
      if ($iter) $Enumerable_detect$25.$$p = null;;
      ;
      if ((block !== nil)) {
      } else {
        return self.$enum_for("detect", ifnone)
      };
      $send(self, 'each', [], ($$26 = function($a){var self = $$26.$$s == null ? this : $$26.$$s, $post_args, args, value = nil;

      
        
        $post_args = Opal.slice.call(arguments, 0, arguments.length);
        
        args = $post_args;;
        value = $$($nesting, 'Opal').$destructure(args);
        if ($truthy(Opal.yield1(block, value))) {
          Opal.ret(value)
        } else {
          return nil
        };}, $$26.$$s = self, $$26.$$arity = -1, $$26));
      
      if (ifnone !== undefined) {
        if (typeof(ifnone) === 'function') {
          return ifnone();
        } else {
          return ifnone;
        }
      }
    ;
      return nil;
      } catch ($returner) { if ($returner === Opal.returner) { return $returner.$v } throw $returner; }
    }, $Enumerable_detect$25.$$arity = -1);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$entries', $Enumerable_entries$39 = function $$entries($a) {
      var $post_args, args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      
      var result = [];

      self.$each.$$p = function() {
        result.push($$($nesting, 'Opal').$destructure(arguments));
      };

      self.$each.apply(self, args);

      return result;
    ;
    }, $Enumerable_entries$39.$$arity = -1);
    Opal.alias(self, "find", "detect");
    
    ;
    
    ;
    
    Opal.def(self, '$first', $Enumerable_first$45 = function $$first(number) {try {

      var $$46, $$47, self = this, result = nil, current = nil;

      
      ;
      if ($truthy(number === undefined)) {
        return $send(self, 'each', [], ($$46 = function(value){var self = $$46.$$s == null ? this : $$46.$$s;

        
          
          if (value == null) {
            value = nil;
          };
          Opal.ret(value);}, $$46.$$s = self, $$46.$$arity = 1, $$46))
      } else {
        
        result = [];
        number = $$($nesting, 'Opal').$coerce_to(number, $$($nesting, 'Integer'), "to_int");
        if ($truthy(number < 0)) {
          self.$raise($$($nesting, 'ArgumentError'), "attempt to take negative size")};
        if ($truthy(number == 0)) {
          return []};
        current = 0;
        $send(self, 'each', [], ($$47 = function($a){var self = $$47.$$s == null ? this : $$47.$$s, $post_args, args;

        
          
          $post_args = Opal.slice.call(arguments, 0, arguments.length);
          
          args = $post_args;;
          result.push($$($nesting, 'Opal').$destructure(args));
          if ($truthy(number <= ++current)) {
            Opal.ret(result)
          } else {
            return nil
          };}, $$47.$$s = self, $$47.$$arity = -1, $$47));
        return result;
      };
      } catch ($returner) { if ($returner === Opal.returner) { return $returner.$v } throw $returner; }
    }, $Enumerable_first$45.$$arity = -1);
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$include?', $Enumerable_include$ques$54 = function(obj) {try {

      var $$55, self = this;

      
      $send(self, 'each', [], ($$55 = function($a){var self = $$55.$$s == null ? this : $$55.$$s, $post_args, args;

      
        
        $post_args = Opal.slice.call(arguments, 0, arguments.length);
        
        args = $post_args;;
        if ($$($nesting, 'Opal').$destructure(args)['$=='](obj)) {
          Opal.ret(true)
        } else {
          return nil
        };}, $$55.$$s = self, $$55.$$arity = -1, $$55));
      return false;
      } catch ($returner) { if ($returner === Opal.returner) { return $returner.$v } throw $returner; }
    }, $Enumerable_include$ques$54.$$arity = 1);
    
    Opal.def(self, '$inject', $Enumerable_inject$56 = function $$inject(object, sym) {
      var $iter = $Enumerable_inject$56.$$p, block = $iter || nil, self = this;

      if ($iter) $Enumerable_inject$56.$$p = null;
      
      
      if ($iter) $Enumerable_inject$56.$$p = null;;
      ;
      ;
      
      var result = object;

      if (block !== nil && sym === undefined) {
        self.$each.$$p = function() {
          var value = $$($nesting, 'Opal').$destructure(arguments);

          if (result === undefined) {
            result = value;
            return;
          }

          value = Opal.yieldX(block, [result, value]);

          result = value;
        };
      }
      else {
        if (sym === undefined) {
          if (!$$($nesting, 'Symbol')['$==='](object)) {
            self.$raise($$($nesting, 'TypeError'), "" + (object.$inspect()) + " is not a Symbol");
          }

          sym    = object;
          result = undefined;
        }

        self.$each.$$p = function() {
          var value = $$($nesting, 'Opal').$destructure(arguments);

          if (result === undefined) {
            result = value;
            return;
          }

          result = (result).$__send__(sym, value);
        };
      }

      self.$each();

      return result == undefined ? nil : result;
    ;
    }, $Enumerable_inject$56.$$arity = -1);
    
    ;
    
    Opal.def(self, '$enumerator_size', $Enumerable_enumerator_size$59 = function $$enumerator_size() {
      var self = this;

      if ($truthy(self['$respond_to?']("size"))) {
        return self.$size()
      } else {
        return nil
      }
    }, $Enumerable_enumerator_size$59.$$arity = 0);
    Opal.alias(self, "map", "collect");
    
    ;
    
    ;
    ;
    
    Opal.def(self, '$min', $Enumerable_min$63 = function $$min(n) {
      var $iter = $Enumerable_min$63.$$p, block = $iter || nil, $$64, self = this;

      if ($iter) $Enumerable_min$63.$$p = null;
      
      
      if ($iter) $Enumerable_min$63.$$p = null;;
      
      if (n == null) {
        n = nil;
      };
      if ($truthy(n['$nil?']())) {
      } else if ((block !== nil)) {
        return $send(self, 'sort', [], ($$64 = function(a, b){var self = $$64.$$s == null ? this : $$64.$$s;

        
          
          if (a == null) {
            a = nil;
          };
          
          if (b == null) {
            b = nil;
          };
          return Opal.yieldX(block, [a, b]);;}, $$64.$$s = self, $$64.$$arity = 2, $$64)).$take(n)
      } else {
        return self.$sort().$take(n)
      };
      
      var result;

      if (block !== nil) {
        self.$each.$$p = function() {
          var param = $$($nesting, 'Opal').$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          var value = block(param, result);

          if (value === nil) {
            self.$raise($$($nesting, 'ArgumentError'), "comparison failed");
          }

          if (value < 0) {
            result = param;
          }
        };
      }
      else {
        self.$each.$$p = function() {
          var param = $$($nesting, 'Opal').$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          if ($$($nesting, 'Opal').$compare(param, result) < 0) {
            result = param;
          }
        };
      }

      self.$each();

      return result === undefined ? nil : result;
    ;
    }, $Enumerable_min$63.$$arity = -1);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    Opal.alias(self, "reduce", "inject");
    
    ;
    
    ;
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$sort', $Enumerable_sort$92 = function $$sort() {
      var $iter = $Enumerable_sort$92.$$p, block = $iter || nil, $$93, self = this, ary = nil;

      if ($iter) $Enumerable_sort$92.$$p = null;
      
      
      if ($iter) $Enumerable_sort$92.$$p = null;;
      ary = self.$to_a();
      if ((block !== nil)) {
      } else {
        block = $lambda(($$93 = function(a, b){var self = $$93.$$s == null ? this : $$93.$$s;

        
          
          if (a == null) {
            a = nil;
          };
          
          if (b == null) {
            b = nil;
          };
          return a['$<=>'](b);}, $$93.$$s = self, $$93.$$arity = 2, $$93))
      };
      return $send(ary, 'sort', [], block.$to_proc());
    }, $Enumerable_sort$92.$$arity = 0);
    
    ;
    
    ;
    
    Opal.def(self, '$take', $Enumerable_take$101 = function $$take(num) {
      var self = this;

      return self.$first(num)
    }, $Enumerable_take$101.$$arity = 1);
    
    ;
    
    ;
    Opal.alias(self, "to_a", "entries");
    
    ;
    
    ;
  })($nesting[0], $nesting)
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/enumerator"] = function(Opal) {
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $truthy = Opal.truthy, $send = Opal.send, $falsy = Opal.falsy;

  
  self.$require("corelib/enumerable");
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Enumerator');

    var $nesting = [self].concat($parent_nesting), $Enumerator_for$1, $Enumerator_initialize$2, $Enumerator_each$3, $Enumerator_size$4, $Enumerator_with_index$5, $Enumerator_each_with_index$7, $Enumerator_inspect$9;

    self.$$prototype.size = self.$$prototype.args = self.$$prototype.object = self.$$prototype.method = nil;
    
    self.$include($$($nesting, 'Enumerable'));
    self.$$prototype.$$is_enumerator = true;
    ;
    
    Opal.def(self, '$initialize', $Enumerator_initialize$2 = function $$initialize($a) {
      var $iter = $Enumerator_initialize$2.$$p, block = $iter || nil, $post_args, $b, self = this;

      if ($iter) $Enumerator_initialize$2.$$p = null;
      
      
      if ($iter) $Enumerator_initialize$2.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      if ($truthy(block)) {
        
        self.object = $send($$($nesting, 'Generator'), 'new', [], block.$to_proc());
        self.method = "each";
        self.args = [];
        self.size = arguments[0] || nil;
        if ($truthy(($truthy($b = self.size) ? self.size['$respond_to?']("call")['$!']() : $b))) {
          return (self.size = $$($nesting, 'Opal').$coerce_to(self.size, $$($nesting, 'Integer'), "to_int"))
        } else {
          return nil
        };
      } else {
        
        self.object = arguments[0];
        self.method = arguments[1] || "each";
        self.args = $slice.call(arguments, 2);
        return (self.size = nil);
      };
    }, $Enumerator_initialize$2.$$arity = -1);
    
    Opal.def(self, '$each', $Enumerator_each$3 = function $$each($a) {
      var $iter = $Enumerator_each$3.$$p, block = $iter || nil, $post_args, args, $b, self = this;

      if ($iter) $Enumerator_each$3.$$p = null;
      
      
      if ($iter) $Enumerator_each$3.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      if ($truthy(($truthy($b = block['$nil?']()) ? args['$empty?']() : $b))) {
        return self};
      args = $rb_plus(self.args, args);
      if ($truthy(block['$nil?']())) {
        return $send(self.$class(), 'new', [self.object, self.method].concat(Opal.to_a(args)))};
      return $send(self.object, '__send__', [self.method].concat(Opal.to_a(args)), block.$to_proc());
    }, $Enumerator_each$3.$$arity = -1);
    
    Opal.def(self, '$size', $Enumerator_size$4 = function $$size() {
      var self = this;

      if ($truthy(self.size['$respond_to?']("call"))) {
        return $send(self.size, 'call', Opal.to_a(self.args))
      } else {
        return self.size
      }
    }, $Enumerator_size$4.$$arity = 0);
    
    ;
    ;
    
    ;
    
    Opal.def(self, '$inspect', $Enumerator_inspect$9 = function $$inspect() {
      var self = this, result = nil;

      
      result = "" + "#<" + (self.$class()) + ": " + (self.object.$inspect()) + ":" + (self.method);
      if ($truthy(self.args['$any?']())) {
        result = $rb_plus(result, "" + "(" + (self.args.$inspect()['$[]']($$($nesting, 'Range').$new(1, -2))) + ")")};
      return $rb_plus(result, ">");
    }, $Enumerator_inspect$9.$$arity = 0);
    (function($base, $super, $parent_nesting) {
      var self = $klass($base, $super, 'Generator');

      var $nesting = [self].concat($parent_nesting), $Generator_initialize$10, $Generator_each$11;

      self.$$prototype.block = nil;
      
      self.$include($$($nesting, 'Enumerable'));
      
      Opal.def(self, '$initialize', $Generator_initialize$10 = function $$initialize() {
        var $iter = $Generator_initialize$10.$$p, block = $iter || nil, self = this;

        if ($iter) $Generator_initialize$10.$$p = null;
        
        
        if ($iter) $Generator_initialize$10.$$p = null;;
        if ($truthy(block)) {
        } else {
          self.$raise($$($nesting, 'LocalJumpError'), "no block given")
        };
        return (self.block = block);
      }, $Generator_initialize$10.$$arity = 0);
      return (Opal.def(self, '$each', $Generator_each$11 = function $$each($a) {
        var $iter = $Generator_each$11.$$p, block = $iter || nil, $post_args, args, self = this, yielder = nil;

        if ($iter) $Generator_each$11.$$p = null;
        
        
        if ($iter) $Generator_each$11.$$p = null;;
        
        $post_args = Opal.slice.call(arguments, 0, arguments.length);
        
        args = $post_args;;
        yielder = $send($$($nesting, 'Yielder'), 'new', [], block.$to_proc());
        
        try {
          args.unshift(yielder);

          Opal.yieldX(self.block, args);
        }
        catch (e) {
          if (e === $breaker) {
            return $breaker.$v;
          }
          else {
            throw e;
          }
        }
      ;
        return self;
      }, $Generator_each$11.$$arity = -1), nil) && 'each';
    })($nesting[0], null, $nesting);
    (function($base, $super, $parent_nesting) {
      var self = $klass($base, $super, 'Yielder');

      var $nesting = [self].concat($parent_nesting), $Yielder_initialize$12, $Yielder_yield$13, $Yielder_$lt$lt$14;

      self.$$prototype.block = nil;
      
      
      Opal.def(self, '$initialize', $Yielder_initialize$12 = function $$initialize() {
        var $iter = $Yielder_initialize$12.$$p, block = $iter || nil, self = this;

        if ($iter) $Yielder_initialize$12.$$p = null;
        
        
        if ($iter) $Yielder_initialize$12.$$p = null;;
        return (self.block = block);
      }, $Yielder_initialize$12.$$arity = 0);
      
      Opal.def(self, '$yield', $Yielder_yield$13 = function($a) {
        var $post_args, values, self = this;

        
        
        $post_args = Opal.slice.call(arguments, 0, arguments.length);
        
        values = $post_args;;
        
        var value = Opal.yieldX(self.block, values);

        if (value === $breaker) {
          throw $breaker;
        }

        return value;
      ;
      }, $Yielder_yield$13.$$arity = -1);
      return (Opal.def(self, '$<<', $Yielder_$lt$lt$14 = function($a) {
        var $post_args, values, self = this;

        
        
        $post_args = Opal.slice.call(arguments, 0, arguments.length);
        
        values = $post_args;;
        $send(self, 'yield', Opal.to_a(values));
        return self;
      }, $Yielder_$lt$lt$14.$$arity = -1), nil) && '<<';
    })($nesting[0], null, $nesting);
    return (function($base, $super, $parent_nesting) {
      var self = $klass($base, $super, 'Lazy');

      var $nesting = [self].concat($parent_nesting), $Lazy_initialize$15, $Lazy_lazy$18, $Lazy_collect$19, $Lazy_collect_concat$21, $Lazy_drop$25, $Lazy_drop_while$27, $Lazy_enum_for$29, $Lazy_find_all$30, $Lazy_grep$32, $Lazy_reject$35, $Lazy_take$37, $Lazy_take_while$39, $Lazy_inspect$41;

      self.$$prototype.enumerator = nil;
      
      (function($base, $super, $parent_nesting) {
        var self = $klass($base, $super, 'StopLazyError');

        var $nesting = [self].concat($parent_nesting);

        return nil
      })($nesting[0], $$($nesting, 'Exception'), $nesting);
      
      Opal.def(self, '$initialize', $Lazy_initialize$15 = function $$initialize(object, size) {
        var $iter = $Lazy_initialize$15.$$p, block = $iter || nil, $$16, self = this;

        if ($iter) $Lazy_initialize$15.$$p = null;
        
        
        if ($iter) $Lazy_initialize$15.$$p = null;;
        
        if (size == null) {
          size = nil;
        };
        if ((block !== nil)) {
        } else {
          self.$raise($$($nesting, 'ArgumentError'), "tried to call lazy new without a block")
        };
        self.enumerator = object;
        return $send(self, Opal.find_super_dispatcher(self, 'initialize', $Lazy_initialize$15, false), [size], ($$16 = function(yielder, $a){var self = $$16.$$s == null ? this : $$16.$$s, $post_args, each_args, $$17;

        
          
          if (yielder == null) {
            yielder = nil;
          };
          
          $post_args = Opal.slice.call(arguments, 1, arguments.length);
          
          each_args = $post_args;;
          try {
            return $send(object, 'each', Opal.to_a(each_args), ($$17 = function($b){var self = $$17.$$s == null ? this : $$17.$$s, $post_args, args;

            
              
              $post_args = Opal.slice.call(arguments, 0, arguments.length);
              
              args = $post_args;;
              
            args.unshift(yielder);

            Opal.yieldX(block, args);
          ;}, $$17.$$s = self, $$17.$$arity = -1, $$17))
          } catch ($err) {
            if (Opal.rescue($err, [$$($nesting, 'Exception')])) {
              try {
                return nil
              } finally { Opal.pop_exception() }
            } else { throw $err; }
          };}, $$16.$$s = self, $$16.$$arity = -2, $$16));
      }, $Lazy_initialize$15.$$arity = -2);
      ;
      
      ;
      
      Opal.def(self, '$collect', $Lazy_collect$19 = function $$collect() {
        var $iter = $Lazy_collect$19.$$p, block = $iter || nil, $$20, self = this;

        if ($iter) $Lazy_collect$19.$$p = null;
        
        
        if ($iter) $Lazy_collect$19.$$p = null;;
        if ($truthy(block)) {
        } else {
          self.$raise($$($nesting, 'ArgumentError'), "tried to call lazy map without a block")
        };
        return $send($$($nesting, 'Lazy'), 'new', [self, self.$enumerator_size()], ($$20 = function(enum$, $a){var self = $$20.$$s == null ? this : $$20.$$s, $post_args, args;

        
          
          if (enum$ == null) {
            enum$ = nil;
          };
          
          $post_args = Opal.slice.call(arguments, 1, arguments.length);
          
          args = $post_args;;
          
          var value = Opal.yieldX(block, args);

          enum$.$yield(value);
        ;}, $$20.$$s = self, $$20.$$arity = -2, $$20));
      }, $Lazy_collect$19.$$arity = 0);
      
      ;
      
      ;
      
      ;
      
      Opal.def(self, '$enum_for', $Lazy_enum_for$29 = function $$enum_for($a, $b) {
        var $iter = $Lazy_enum_for$29.$$p, block = $iter || nil, $post_args, method, args, self = this;

        if ($iter) $Lazy_enum_for$29.$$p = null;
        
        
        if ($iter) $Lazy_enum_for$29.$$p = null;;
        
        $post_args = Opal.slice.call(arguments, 0, arguments.length);
        
        if ($post_args.length > 0) {
          method = $post_args[0];
          $post_args.splice(0, 1);
        }
        if (method == null) {
          method = "each";
        };
        
        args = $post_args;;
        return $send(self.$class(), 'for', [self, method].concat(Opal.to_a(args)), block.$to_proc());
      }, $Lazy_enum_for$29.$$arity = -1);
      
      ;
      ;
      
      ;
      Opal.alias(self, "map", "collect");
      ;
      
      ;
      
      Opal.def(self, '$take', $Lazy_take$37 = function $$take(n) {
        var $$38, self = this, current_size = nil, set_size = nil, taken = nil;

        
        n = $$($nesting, 'Opal').$coerce_to(n, $$($nesting, 'Integer'), "to_int");
        if ($truthy($rb_lt(n, 0))) {
          self.$raise($$($nesting, 'ArgumentError'), "attempt to take negative size")};
        current_size = self.$enumerator_size();
        set_size = (function() {if ($truthy($$($nesting, 'Integer')['$==='](current_size))) {
          if ($truthy($rb_lt(n, current_size))) {
            return n
          } else {
            return current_size
          }
        } else {
          return current_size
        }; return nil; })();
        taken = 0;
        return $send($$($nesting, 'Lazy'), 'new', [self, set_size], ($$38 = function(enum$, $a){var self = $$38.$$s == null ? this : $$38.$$s, $post_args, args;

        
          
          if (enum$ == null) {
            enum$ = nil;
          };
          
          $post_args = Opal.slice.call(arguments, 1, arguments.length);
          
          args = $post_args;;
          if ($truthy($rb_lt(taken, n))) {
            
            $send(enum$, 'yield', Opal.to_a(args));
            return (taken = $rb_plus(taken, 1));
          } else {
            return self.$raise($$($nesting, 'StopLazyError'))
          };}, $$38.$$s = self, $$38.$$arity = -2, $$38));
      }, $Lazy_take$37.$$arity = 1);
      
      ;
      ;
      return (Opal.def(self, '$inspect', $Lazy_inspect$41 = function $$inspect() {
        var self = this;

        return "" + "#<" + (self.$class()) + ": " + (self.enumerator.$inspect()) + ">"
      }, $Lazy_inspect$41.$$arity = 0), nil) && 'inspect';
    })($nesting[0], self, $nesting);
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/numeric"] = function(Opal) {
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_times(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs * rhs : lhs['$*'](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $hash2 = Opal.hash2;

  
  self.$require("corelib/comparable");
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Numeric');

    var $nesting = [self].concat($parent_nesting), $Numeric_coerce$1, $Numeric___coerced__$2, $Numeric_$lt_eq_gt$3, $Numeric_$plus$$4, $Numeric_$minus$$5, $Numeric_$percent$6, $Numeric_abs$7, $Numeric_abs2$8, $Numeric_angle$9, $Numeric_ceil$10, $Numeric_conj$11, $Numeric_denominator$12, $Numeric_div$13, $Numeric_divmod$14, $Numeric_fdiv$15, $Numeric_floor$16, $Numeric_i$17, $Numeric_imag$18, $Numeric_integer$ques$19, $Numeric_nonzero$ques$20, $Numeric_numerator$21, $Numeric_polar$22, $Numeric_quo$23, $Numeric_real$24, $Numeric_real$ques$25, $Numeric_rect$26, $Numeric_round$27, $Numeric_to_c$28, $Numeric_to_int$29, $Numeric_truncate$30, $Numeric_zero$ques$31, $Numeric_positive$ques$32, $Numeric_negative$ques$33, $Numeric_dup$34, $Numeric_clone$35, $Numeric_finite$ques$36, $Numeric_infinite$ques$37;

    
    self.$include($$($nesting, 'Comparable'));
    
    Opal.def(self, '$coerce', $Numeric_coerce$1 = function $$coerce(other) {
      var self = this;

      
      if ($truthy(other['$instance_of?'](self.$class()))) {
        return [other, self]};
      return [self.$Float(other), self.$Float(self)];
    }, $Numeric_coerce$1.$$arity = 1);
    
    Opal.def(self, '$__coerced__', $Numeric___coerced__$2 = function $$__coerced__(method, other) {
      var $a, $b, self = this, a = nil, b = nil, $case = nil;

      if ($truthy(other['$respond_to?']("coerce"))) {
        
        $b = other.$coerce(self), $a = Opal.to_ary($b), (a = ($a[0] == null ? nil : $a[0])), (b = ($a[1] == null ? nil : $a[1])), $b;
        return a.$__send__(method, b);
      } else {
        return (function() {$case = method;
        if ("+"['$===']($case) || "-"['$===']($case) || "*"['$===']($case) || "/"['$===']($case) || "%"['$===']($case) || "&"['$===']($case) || "|"['$===']($case) || "^"['$===']($case) || "**"['$===']($case)) {return self.$raise($$($nesting, 'TypeError'), "" + (other.$class()) + " can't be coerced into Numeric")}
        else if (">"['$===']($case) || ">="['$===']($case) || "<"['$===']($case) || "<="['$===']($case) || "<=>"['$===']($case)) {return self.$raise($$($nesting, 'ArgumentError'), "" + "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")}
        else { return nil }})()
      }
    }, $Numeric___coerced__$2.$$arity = 2);
    
    Opal.def(self, '$<=>', $Numeric_$lt_eq_gt$3 = function(other) {
      var self = this;

      
      if ($truthy(self['$equal?'](other))) {
        return 0};
      return nil;
    }, $Numeric_$lt_eq_gt$3.$$arity = 1);
    
    ;
    
    Opal.def(self, '$-@', $Numeric_$minus$$5 = function() {
      var self = this;

      return $rb_minus(0, self)
    }, $Numeric_$minus$$5.$$arity = 0);
    
    Opal.def(self, '$%', $Numeric_$percent$6 = function(other) {
      var self = this;

      return $rb_minus(self, $rb_times(other, self.$div(other)))
    }, $Numeric_$percent$6.$$arity = 1);
    
    Opal.def(self, '$abs', $Numeric_abs$7 = function $$abs() {
      var self = this;

      if ($rb_lt(self, 0)) {
        return self['$-@']()
      } else {
        return self
      }
    }, $Numeric_abs$7.$$arity = 0);
    
    Opal.def(self, '$abs2', $Numeric_abs2$8 = function $$abs2() {
      var self = this;

      return $rb_times(self, self)
    }, $Numeric_abs2$8.$$arity = 0);
    
    Opal.def(self, '$angle', $Numeric_angle$9 = function $$angle() {
      var self = this;

      if ($rb_lt(self, 0)) {
        return $$$($$($nesting, 'Math'), 'PI')
      } else {
        return 0
      }
    }, $Numeric_angle$9.$$arity = 0);
    Opal.alias(self, "arg", "angle");
    
    Opal.def(self, '$ceil', $Numeric_ceil$10 = function $$ceil(ndigits) {
      var self = this;

      
      
      if (ndigits == null) {
        ndigits = 0;
      };
      return self.$to_f().$ceil(ndigits);
    }, $Numeric_ceil$10.$$arity = -1);
    
    Opal.def(self, '$conj', $Numeric_conj$11 = function $$conj() {
      var self = this;

      return self
    }, $Numeric_conj$11.$$arity = 0);
    ;
    
    Opal.def(self, '$denominator', $Numeric_denominator$12 = function $$denominator() {
      var self = this;

      return self.$to_r().$denominator()
    }, $Numeric_denominator$12.$$arity = 0);
    
    Opal.def(self, '$div', $Numeric_div$13 = function $$div(other) {
      var self = this;

      
      if (other['$=='](0)) {
        self.$raise($$($nesting, 'ZeroDivisionError'), "divided by o")};
      return $rb_divide(self, other).$floor();
    }, $Numeric_div$13.$$arity = 1);
    
    Opal.def(self, '$divmod', $Numeric_divmod$14 = function $$divmod(other) {
      var self = this;

      return [self.$div(other), self['$%'](other)]
    }, $Numeric_divmod$14.$$arity = 1);
    
    ;
    
    Opal.def(self, '$floor', $Numeric_floor$16 = function $$floor(ndigits) {
      var self = this;

      
      
      if (ndigits == null) {
        ndigits = 0;
      };
      return self.$to_f().$floor(ndigits);
    }, $Numeric_floor$16.$$arity = -1);
    
    ;
    
    Opal.def(self, '$imag', $Numeric_imag$18 = function $$imag() {
      var self = this;

      return 0
    }, $Numeric_imag$18.$$arity = 0);
    ;
    
    ;
    ;
    ;
    
    ;
    
    Opal.def(self, '$numerator', $Numeric_numerator$21 = function $$numerator() {
      var self = this;

      return self.$to_r().$numerator()
    }, $Numeric_numerator$21.$$arity = 0);
    ;
    
    Opal.def(self, '$polar', $Numeric_polar$22 = function $$polar() {
      var self = this;

      return [self.$abs(), self.$arg()]
    }, $Numeric_polar$22.$$arity = 0);
    
    Opal.def(self, '$quo', $Numeric_quo$23 = function $$quo(other) {
      var self = this;

      return $rb_divide($$($nesting, 'Opal')['$coerce_to!'](self, $$($nesting, 'Rational'), "to_r"), other)
    }, $Numeric_quo$23.$$arity = 1);
    
    Opal.def(self, '$real', $Numeric_real$24 = function $$real() {
      var self = this;

      return self
    }, $Numeric_real$24.$$arity = 0);
    
    Opal.def(self, '$real?', $Numeric_real$ques$25 = function() {
      var self = this;

      return true
    }, $Numeric_real$ques$25.$$arity = 0);
    
    ;
    ;
    
    Opal.def(self, '$round', $Numeric_round$27 = function $$round(digits) {
      var self = this;

      
      ;
      return self.$to_f().$round(digits);
    }, $Numeric_round$27.$$arity = -1);
    
    ;
    
    Opal.def(self, '$to_int', $Numeric_to_int$29 = function $$to_int() {
      var self = this;

      return self.$to_i()
    }, $Numeric_to_int$29.$$arity = 0);
    
    Opal.def(self, '$truncate', $Numeric_truncate$30 = function $$truncate(ndigits) {
      var self = this;

      
      
      if (ndigits == null) {
        ndigits = 0;
      };
      return self.$to_f().$truncate(ndigits);
    }, $Numeric_truncate$30.$$arity = -1);
    
    Opal.def(self, '$zero?', $Numeric_zero$ques$31 = function() {
      var self = this;

      return self['$=='](0)
    }, $Numeric_zero$ques$31.$$arity = 0);
    
    Opal.def(self, '$positive?', $Numeric_positive$ques$32 = function() {
      var self = this;

      return $rb_gt(self, 0)
    }, $Numeric_positive$ques$32.$$arity = 0);
    
    Opal.def(self, '$negative?', $Numeric_negative$ques$33 = function() {
      var self = this;

      return $rb_lt(self, 0)
    }, $Numeric_negative$ques$33.$$arity = 0);
    
    Opal.def(self, '$dup', $Numeric_dup$34 = function $$dup() {
      var self = this;

      return self
    }, $Numeric_dup$34.$$arity = 0);
    
    Opal.def(self, '$clone', $Numeric_clone$35 = function $$clone($kwargs) {
      var freeze, self = this;

      
      
      if ($kwargs == null) {
        $kwargs = $hash2([], {});
      } else if (!$kwargs.$$is_hash) {
        throw Opal.ArgumentError.$new('expected kwargs');
      };
      
      freeze = $kwargs.$$smap["freeze"];
      if (freeze == null) {
        freeze = true
      };
      return self;
    }, $Numeric_clone$35.$$arity = -1);
    
    Opal.def(self, '$finite?', $Numeric_finite$ques$36 = function() {
      var self = this;

      return true
    }, $Numeric_finite$ques$36.$$arity = 0);
    return (Opal.def(self, '$infinite?', $Numeric_infinite$ques$37 = function() {
      var self = this;

      return nil
    }, $Numeric_infinite$ques$37.$$arity = 0), nil) && 'infinite?';
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/array"] = function(Opal) {
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  function $rb_times(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs * rhs : lhs['$*'](rhs);
  }
  function $rb_ge(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs >= rhs : lhs['$>='](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $hash2 = Opal.hash2, $send = Opal.send, $gvars = Opal.gvars;

  
  self.$require("corelib/enumerable");
  self.$require("corelib/numeric");
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Array');

    var $nesting = [self].concat($parent_nesting), $Array_$$$1, $Array_initialize$2, $Array_try_convert$3, $Array_$$4, $Array_$$5, $Array_$$6, $Array_$plus$7, $Array_$minus$8, $Array_$lt$lt$9, $Array_$lt_eq_gt$10, $Array_$eq_eq$11, $Array_$$$12, $Array_$$$eq$13, $Array_any$ques$14, $Array_assoc$15, $Array_at$16, $Array_bsearch_index$17, $Array_bsearch$18, $Array_cycle$19, $Array_clear$21, $Array_count$22, $Array_initialize_copy$23, $Array_collect$24, $Array_collect$excl$26, $Array_combination$28, $Array_repeated_combination$30, $Array_compact$32, $Array_compact$excl$33, $Array_concat$34, $Array_delete$37, $Array_delete_at$38, $Array_delete_if$39, $Array_dig$41, $Array_drop$42, $Array_dup$43, $Array_each$44, $Array_each_index$46, $Array_empty$ques$48, $Array_eql$ques$49, $Array_fetch$50, $Array_fill$51, $Array_first$52, $Array_flatten$53, $Array_flatten$excl$54, $Array_hash$55, $Array_include$ques$56, $Array_index$57, $Array_insert$58, $Array_inspect$59, $Array_join$60, $Array_keep_if$61, $Array_last$63, $Array_length$64, $Array_max$65, $Array_min$66, $Array_permutation$67, $Array_repeated_permutation$69, $Array_pop$71, $Array_product$72, $Array_push$73, $Array_rassoc$74, $Array_reject$75, $Array_reject$excl$77, $Array_replace$79, $Array_reverse$80, $Array_reverse$excl$81, $Array_reverse_each$82, $Array_rindex$84, $Array_rotate$85, $Array_rotate$excl$86, $Array_sample$89, $Array_select$90, $Array_select$excl$92, $Array_shift$94, $Array_shuffle$95, $Array_shuffle$excl$96, $Array_slice$excl$97, $Array_sort$98, $Array_sort$excl$99, $Array_sort_by$excl$100, $Array_take$102, $Array_take_while$103, $Array_to_a$104, $Array_to_h$105, $Array_transpose$106, $Array_uniq$109, $Array_uniq$excl$110, $Array_unshift$111, $Array_values_at$112, $Array_zip$115, $Array_inherited$116, $Array_instance_variables$117, $Array_pack$119;

    
    self.$include($$($nesting, 'Enumerable'));
    Opal.defineProperty(self.$$prototype, '$$is_array', true);
    
    function toArraySubclass(obj, klass) {
      if (klass.$$name === Opal.Array) {
        return obj;
      } else {
        return klass.$allocate().$replace((obj).$to_a());
      }
    }
  ;
    Opal.defs(self, '$[]', $Array_$$$1 = function($a) {
      var $post_args, objects, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      objects = $post_args;;
      return toArraySubclass(objects, self);;
    }, $Array_$$$1.$$arity = -1);
    
    Opal.def(self, '$initialize', $Array_initialize$2 = function $$initialize(size, obj) {
      var $iter = $Array_initialize$2.$$p, block = $iter || nil, self = this;

      if ($iter) $Array_initialize$2.$$p = null;
      
      
      if ($iter) $Array_initialize$2.$$p = null;;
      
      if (size == null) {
        size = nil;
      };
      
      if (obj == null) {
        obj = nil;
      };
      
      if (obj !== nil && block !== nil) {
        self.$warn("warning: block supersedes default value argument")
      }

      if (size > $$$($$($nesting, 'Integer'), 'MAX')) {
        self.$raise($$($nesting, 'ArgumentError'), "array size too big")
      }

      if (arguments.length > 2) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "wrong number of arguments (" + (arguments.length) + " for 0..2)")
      }

      if (arguments.length === 0) {
        self.splice(0, self.length);
        return self;
      }

      if (arguments.length === 1) {
        if (size.$$is_array) {
          self.$replace(size.$to_a())
          return self;
        } else if (size['$respond_to?']("to_ary")) {
          self.$replace(size.$to_ary())
          return self;
        }
      }

      size = $$($nesting, 'Opal').$coerce_to(size, $$($nesting, 'Integer'), "to_int")

      if (size < 0) {
        self.$raise($$($nesting, 'ArgumentError'), "negative array size")
      }

      self.splice(0, self.length);
      var i, value;

      if (block === nil) {
        for (i = 0; i < size; i++) {
          self.push(obj);
        }
      }
      else {
        for (i = 0, value; i < size; i++) {
          value = block(i);
          self[i] = value;
        }
      }

      return self;
    ;
    }, $Array_initialize$2.$$arity = -1);
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$*', $Array_$$6 = function(other) {
      var self = this;

      
      if ($truthy(other['$respond_to?']("to_str"))) {
        return self.$join(other.$to_str())};
      other = $$($nesting, 'Opal').$coerce_to(other, $$($nesting, 'Integer'), "to_int");
      if ($truthy(other < 0)) {
        self.$raise($$($nesting, 'ArgumentError'), "negative argument")};
      
      var result = [],
          converted = self.$to_a();

      for (var i = 0; i < other; i++) {
        result = result.concat(converted);
      }

      return toArraySubclass(result, self.$class());
    ;
    }, $Array_$$6.$$arity = 1);
    
    Opal.def(self, '$+', $Array_$plus$7 = function(other) {
      var self = this;

      
      other = (function() {if ($truthy($$($nesting, 'Array')['$==='](other))) {
        return other.$to_a()
      } else {
        return $$($nesting, 'Opal').$coerce_to(other, $$($nesting, 'Array'), "to_ary").$to_a()
      }; return nil; })();
      return self.concat(other);;
    }, $Array_$plus$7.$$arity = 1);
    
    Opal.def(self, '$-', $Array_$minus$8 = function(other) {
      var self = this;

      
      other = (function() {if ($truthy($$($nesting, 'Array')['$==='](other))) {
        return other.$to_a()
      } else {
        return $$($nesting, 'Opal').$coerce_to(other, $$($nesting, 'Array'), "to_ary").$to_a()
      }; return nil; })();
      if ($truthy(self.length === 0)) {
        return []};
      if ($truthy(other.length === 0)) {
        return self.slice()};
      
      var result = [], hash = $hash2([], {}), i, length, item;

      for (i = 0, length = other.length; i < length; i++) {
        Opal.hash_put(hash, other[i], true);
      }

      for (i = 0, length = self.length; i < length; i++) {
        item = self[i];
        if (Opal.hash_get(hash, item) === undefined) {
          result.push(item);
        }
      }

      return result;
    ;
    }, $Array_$minus$8.$$arity = 1);
    
    Opal.def(self, '$<<', $Array_$lt$lt$9 = function(object) {
      var self = this;

      
      self.push(object);
      return self;
    }, $Array_$lt$lt$9.$$arity = 1);
    
    Opal.def(self, '$<=>', $Array_$lt_eq_gt$10 = function(other) {
      var self = this;

      
      if ($truthy($$($nesting, 'Array')['$==='](other))) {
        other = other.$to_a()
      } else if ($truthy(other['$respond_to?']("to_ary"))) {
        other = other.$to_ary().$to_a()
      } else {
        return nil
      };
      
      if (self.$hash() === other.$hash()) {
        return 0;
      }

      var count = Math.min(self.length, other.length);

      for (var i = 0; i < count; i++) {
        var tmp = (self[i])['$<=>'](other[i]);

        if (tmp !== 0) {
          return tmp;
        }
      }

      return (self.length)['$<=>'](other.length);
    ;
    }, $Array_$lt_eq_gt$10.$$arity = 1);
    
    Opal.def(self, '$==', $Array_$eq_eq$11 = function(other) {
      var self = this;

      
      var recursed = {};

      function _eqeq(array, other) {
        var i, length, a, b;

        if (array === other)
          return true;

        if (!other.$$is_array) {
          if ($$($nesting, 'Opal')['$respond_to?'](other, "to_ary")) {
            return (other)['$=='](array);
          } else {
            return false;
          }
        }

        if (array.$$constructor !== Array)
          array = (array).$to_a();
        if (other.$$constructor !== Array)
          other = (other).$to_a();

        if (array.length !== other.length) {
          return false;
        }

        recursed[(array).$object_id()] = true;

        for (i = 0, length = array.length; i < length; i++) {
          a = array[i];
          b = other[i];
          if (a.$$is_array) {
            if (b.$$is_array && b.length !== a.length) {
              return false;
            }
            if (!recursed.hasOwnProperty((a).$object_id())) {
              if (!_eqeq(a, b)) {
                return false;
              }
            }
          } else {
            if (!(a)['$=='](b)) {
              return false;
            }
          }
        }

        return true;
      }

      return _eqeq(self, other);
    
    }, $Array_$eq_eq$11.$$arity = 1);
    
    function $array_slice_range(self, index) {
      var size = self.length,
          exclude, from, to, result;

      exclude = index.excl;
      from    = Opal.Opal.$coerce_to(index.begin, Opal.Integer, 'to_int');
      to      = Opal.Opal.$coerce_to(index.end, Opal.Integer, 'to_int');

      if (from < 0) {
        from += size;

        if (from < 0) {
          return nil;
        }
      }

      if (from > size) {
        return nil;
      }

      if (to < 0) {
        to += size;

        if (to < 0) {
          return [];
        }
      }

      if (!exclude) {
        to += 1;
      }

      result = self.slice(from, to);
      return toArraySubclass(result, self.$class());
    }

    function $array_slice_index_length(self, index, length) {
      var size = self.length,
          exclude, from, to, result;

      index = Opal.Opal.$coerce_to(index, Opal.Integer, 'to_int');

      if (index < 0) {
        index += size;

        if (index < 0) {
          return nil;
        }
      }

      if (length === undefined) {
        if (index >= size || index < 0) {
          return nil;
        }

        return self[index];
      }
      else {
        length = Opal.Opal.$coerce_to(length, Opal.Integer, 'to_int');

        if (length < 0 || index > size || index < 0) {
          return nil;
        }

        result = self.slice(index, index + length);
      }
      return toArraySubclass(result, self.$class());
    }
  ;
    
    Opal.def(self, '$[]', $Array_$$$12 = function(index, length) {
      var self = this;

      
      ;
      
      if (index.$$is_range) {
        return $array_slice_range(self, index);
      }
      else {
        return $array_slice_index_length(self, index, length);
      }
    ;
    }, $Array_$$$12.$$arity = -2);
    
    Opal.def(self, '$[]=', $Array_$$$eq$13 = function(index, value, extra) {
      var self = this, data = nil, length = nil;

      
      ;
            var i, size = self.length;;
      if ($truthy($$($nesting, 'Range')['$==='](index))) {
        
        data = (function() {if ($truthy($$($nesting, 'Array')['$==='](value))) {
          return value.$to_a()
        } else if ($truthy(value['$respond_to?']("to_ary"))) {
          return value.$to_ary().$to_a()
        } else {
          return [value]
        }; return nil; })();
        
        var exclude = index.excl,
            from    = $$($nesting, 'Opal').$coerce_to(index.begin, $$($nesting, 'Integer'), "to_int"),
            to      = $$($nesting, 'Opal').$coerce_to(index.end, $$($nesting, 'Integer'), "to_int");

        if (from < 0) {
          from += size;

          if (from < 0) {
            self.$raise($$($nesting, 'RangeError'), "" + (index.$inspect()) + " out of range");
          }
        }

        if (to < 0) {
          to += size;
        }

        if (!exclude) {
          to += 1;
        }

        if (from > size) {
          for (i = size; i < from; i++) {
            self[i] = nil;
          }
        }

        if (to < 0) {
          self.splice.apply(self, [from, 0].concat(data));
        }
        else {
          self.splice.apply(self, [from, to - from].concat(data));
        }

        return value;
      ;
      } else {
        
        if ($truthy(extra === undefined)) {
          length = 1
        } else {
          
          length = value;
          value = extra;
          data = (function() {if ($truthy($$($nesting, 'Array')['$==='](value))) {
            return value.$to_a()
          } else if ($truthy(value['$respond_to?']("to_ary"))) {
            return value.$to_ary().$to_a()
          } else {
            return [value]
          }; return nil; })();
        };
        
        var old;

        index  = $$($nesting, 'Opal').$coerce_to(index, $$($nesting, 'Integer'), "to_int");
        length = $$($nesting, 'Opal').$coerce_to(length, $$($nesting, 'Integer'), "to_int");

        if (index < 0) {
          old    = index;
          index += size;

          if (index < 0) {
            self.$raise($$($nesting, 'IndexError'), "" + "index " + (old) + " too small for array; minimum " + (-self.length));
          }
        }

        if (length < 0) {
          self.$raise($$($nesting, 'IndexError'), "" + "negative length (" + (length) + ")")
        }

        if (index > size) {
          for (i = size; i < index; i++) {
            self[i] = nil;
          }
        }

        if (extra === undefined) {
          self[index] = value;
        }
        else {
          self.splice.apply(self, [index, length].concat(data));
        }

        return value;
      ;
      };
    }, $Array_$$$eq$13.$$arity = -3);
    
    Opal.def(self, '$any?', $Array_any$ques$14 = function(pattern) {
      var $iter = $Array_any$ques$14.$$p, block = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Array_any$ques$14.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      
      
      if ($iter) $Array_any$ques$14.$$p = null;;
      ;
      if (self.length === 0) return false;
      return $send(self, Opal.find_super_dispatcher(self, 'any?', $Array_any$ques$14, false), $zuper, $iter);
    }, $Array_any$ques$14.$$arity = -1);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$initialize_copy', $Array_initialize_copy$23 = function $$initialize_copy(other) {
      var self = this;

      return self.$replace(other)
    }, $Array_initialize_copy$23.$$arity = 1);
    
    Opal.def(self, '$collect', $Array_collect$24 = function $$collect() {
      var $iter = $Array_collect$24.$$p, block = $iter || nil, $$25, self = this;

      if ($iter) $Array_collect$24.$$p = null;
      
      
      if ($iter) $Array_collect$24.$$p = null;;
      if ((block !== nil)) {
      } else {
        return $send(self, 'enum_for', ["collect"], ($$25 = function(){var self = $$25.$$s == null ? this : $$25.$$s;

        return self.$size()}, $$25.$$s = self, $$25.$$arity = 0, $$25))
      };
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.yield1(block, self[i]);
        result.push(value);
      }

      return result;
    ;
    }, $Array_collect$24.$$arity = 0);
    
    ;
    
   
  ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$concat', $Array_concat$34 = function $$concat($a) {
      var $post_args, others, $$35, $$36, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      others = $post_args;;
      others = $send(others, 'map', [], ($$35 = function(other){var self = $$35.$$s == null ? this : $$35.$$s;

      
        
        if (other == null) {
          other = nil;
        };
        other = (function() {if ($truthy($$($nesting, 'Array')['$==='](other))) {
          return other.$to_a()
        } else {
          return $$($nesting, 'Opal').$coerce_to(other, $$($nesting, 'Array'), "to_ary").$to_a()
        }; return nil; })();
        if ($truthy(other['$equal?'](self))) {
          other = other.$dup()};
        return other;}, $$35.$$s = self, $$35.$$arity = 1, $$35));
      $send(others, 'each', [], ($$36 = function(other){var self = $$36.$$s == null ? this : $$36.$$s;

      
        
        if (other == null) {
          other = nil;
        };
        
        for (var i = 0, length = other.length; i < length; i++) {
          self.push(other[i]);
        }
      ;}, $$36.$$s = self, $$36.$$arity = 1, $$36));
      return self;
    }, $Array_concat$34.$$arity = -1);
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$dig', $Array_dig$41 = function $$dig(idx, $a) {
      var $post_args, idxs, self = this, item = nil;

      
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      idxs = $post_args;;
      item = self['$[]'](idx);
      
      if (item === nil || idxs.length === 0) {
        return item;
      }
    ;
      if ($truthy(item['$respond_to?']("dig"))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "" + (item.$class()) + " does not have #dig method")
      };
      return $send(item, 'dig', Opal.to_a(idxs));
    }, $Array_dig$41.$$arity = -2);
    
    ;
    
    Opal.def(self, '$dup', $Array_dup$43 = function $$dup() {
      var $iter = $Array_dup$43.$$p, $yield = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Array_dup$43.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      
      
      if (self.$$class === Opal.Array &&
          self.$$class.$allocate.$$pristine &&
          self.$copy_instance_variables.$$pristine &&
          self.$initialize_dup.$$pristine) {
        return self.slice(0);
      }
    ;
      return $send(self, Opal.find_super_dispatcher(self, 'dup', $Array_dup$43, false), $zuper, $iter);
    }, $Array_dup$43.$$arity = 0);
    
    Opal.def(self, '$each', $Array_each$44 = function $$each() {
      var $iter = $Array_each$44.$$p, block = $iter || nil, $$45, self = this;

      if ($iter) $Array_each$44.$$p = null;
      
      
      if ($iter) $Array_each$44.$$p = null;;
      if ((block !== nil)) {
      } else {
        return $send(self, 'enum_for', ["each"], ($$45 = function(){var self = $$45.$$s == null ? this : $$45.$$s;

        return self.$size()}, $$45.$$s = self, $$45.$$arity = 0, $$45))
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.yield1(block, self[i]);
      }
    ;
      return self;
    }, $Array_each$44.$$arity = 0);
    
    ;
    
    Opal.def(self, '$empty?', $Array_empty$ques$48 = function() {
      var self = this;

      return self.length === 0;
    }, $Array_empty$ques$48.$$arity = 0);
    
    Opal.def(self, '$eql?', $Array_eql$ques$49 = function(other) {
      var self = this;

      
      var recursed = {};

      function _eql(array, other) {
        var i, length, a, b;

        if (!other.$$is_array) {
          return false;
        }

        other = other.$to_a();

        if (array.length !== other.length) {
          return false;
        }

        recursed[(array).$object_id()] = true;

        for (i = 0, length = array.length; i < length; i++) {
          a = array[i];
          b = other[i];
          if (a.$$is_array) {
            if (b.$$is_array && b.length !== a.length) {
              return false;
            }
            if (!recursed.hasOwnProperty((a).$object_id())) {
              if (!_eql(a, b)) {
                return false;
              }
            }
          } else {
            if (!(a)['$eql?'](b)) {
              return false;
            }
          }
        }

        return true;
      }

      return _eql(self, other);
    
    }, $Array_eql$ques$49.$$arity = 1);
    
    Opal.def(self, '$fetch', $Array_fetch$50 = function $$fetch(index, defaults) {
      var $iter = $Array_fetch$50.$$p, block = $iter || nil, self = this;

      if ($iter) $Array_fetch$50.$$p = null;
      
      
      if ($iter) $Array_fetch$50.$$p = null;;
      ;
      
      var original = index;

      index = $$($nesting, 'Opal').$coerce_to(index, $$($nesting, 'Integer'), "to_int");

      if (index < 0) {
        index += self.length;
      }

      if (index >= 0 && index < self.length) {
        return self[index];
      }

      if (block !== nil && defaults != null) {
        self.$warn("warning: block supersedes default value argument")
      }

      if (block !== nil) {
        return block(original);
      }

      if (defaults != null) {
        return defaults;
      }

      if (self.length === 0) {
        self.$raise($$($nesting, 'IndexError'), "" + "index " + (original) + " outside of array bounds: 0...0")
      }
      else {
        self.$raise($$($nesting, 'IndexError'), "" + "index " + (original) + " outside of array bounds: -" + (self.length) + "..." + (self.length));
      }
    ;
    }, $Array_fetch$50.$$arity = -2);
    
    ;
    
    Opal.def(self, '$first', $Array_first$52 = function $$first(count) {
      var self = this;

      
      ;
      
      if (count == null) {
        return self.length === 0 ? nil : self[0];
      }

      count = $$($nesting, 'Opal').$coerce_to(count, $$($nesting, 'Integer'), "to_int");

      if (count < 0) {
        self.$raise($$($nesting, 'ArgumentError'), "negative array size");
      }

      return self.slice(0, count);
    ;
    }, $Array_first$52.$$arity = -1);
    
    Opal.def(self, '$flatten', $Array_flatten$53 = function $$flatten(level) {
      var self = this;

      
      ;
      
      function _flatten(array, level) {
        var result = [],
            i, length,
            item, ary;

        array = (array).$to_a();

        for (i = 0, length = array.length; i < length; i++) {
          item = array[i];

          if (!$$($nesting, 'Opal')['$respond_to?'](item, "to_ary", true)) {
            result.push(item);
            continue;
          }

          ary = (item).$to_ary();

          if (ary === nil) {
            result.push(item);
            continue;
          }

          if (!ary.$$is_array) {
            self.$raise($$($nesting, 'TypeError'));
          }

          if (ary === self) {
            self.$raise($$($nesting, 'ArgumentError'));
          }

          switch (level) {
          case undefined:
            result = result.concat(_flatten(ary));
            break;
          case 0:
            result.push(ary);
            break;
          default:
            result.push.apply(result, _flatten(ary, level - 1));
          }
        }
        return result;
      }

      if (level !== undefined) {
        level = $$($nesting, 'Opal').$coerce_to(level, $$($nesting, 'Integer'), "to_int");
      }

      return toArraySubclass(_flatten(self, level), self.$class());
    ;
    }, $Array_flatten$53.$$arity = -1);
    
    ;
    
    Opal.def(self, '$hash', $Array_hash$55 = function $$hash() {
      var self = this;

      
      var top = (Opal.hash_ids === undefined),
          result = ['A'],
          hash_id = self.$object_id(),
          item, i, key;

      try {
        if (top) {
          Opal.hash_ids = Object.create(null);
        }

        // return early for recursive structures
        if (Opal.hash_ids[hash_id]) {
          return 'self';
        }

        for (key in Opal.hash_ids) {
          item = Opal.hash_ids[key];
          if (self['$eql?'](item)) {
            return 'self';
          }
        }

        Opal.hash_ids[hash_id] = self;

        for (i = 0; i < self.length; i++) {
          item = self[i];
          result.push(item.$hash());
        }

        return result.join(',');
      } finally {
        if (top) {
          Opal.hash_ids = undefined;
        }
      }
    
    }, $Array_hash$55.$$arity = 0);
    
    Opal.def(self, '$include?', $Array_include$ques$56 = function(member) {
      var self = this;

      
      for (var i = 0, length = self.length; i < length; i++) {
        if ((self[i])['$=='](member)) {
          return true;
        }
      }

      return false;
    
    }, $Array_include$ques$56.$$arity = 1);
    
    ;
    
    ;
    
    Opal.def(self, '$inspect', $Array_inspect$59 = function $$inspect() {
      var self = this;

      
      var result = [],
          id     = self.$__id__();

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self['$[]'](i);

        if ((item).$__id__() === id) {
          result.push('[...]');
        }
        else {
          result.push((item).$inspect());
        }
      }

      return '[' + result.join(', ') + ']';
    
    }, $Array_inspect$59.$$arity = 0);
    
    Opal.def(self, '$join', $Array_join$60 = function $$join(sep) {
      var self = this;
      if ($gvars[","] == null) $gvars[","] = nil;

      
      
      if (sep == null) {
        sep = nil;
      };
      if ($truthy(self.length === 0)) {
        return ""};
      if ($truthy(sep === nil)) {
        sep = $gvars[","]};
      
      var result = [];
      var i, length, item, tmp;

      for (i = 0, length = self.length; i < length; i++) {
        item = self[i];

        if ($$($nesting, 'Opal')['$respond_to?'](item, "to_str")) {
          tmp = (item).$to_str();

          if (tmp !== nil) {
            result.push((tmp).$to_s());

            continue;
          }
        }

        if ($$($nesting, 'Opal')['$respond_to?'](item, "to_ary")) {
          tmp = (item).$to_ary();

          if (tmp === self) {
            self.$raise($$($nesting, 'ArgumentError'));
          }

          if (tmp !== nil) {
            result.push((tmp).$join(sep));

            continue;
          }
        }

        if ($$($nesting, 'Opal')['$respond_to?'](item, "to_s")) {
          tmp = (item).$to_s();

          if (tmp !== nil) {
            result.push(tmp);

            continue;
          }
        }

        self.$raise($$($nesting, 'NoMethodError').$new("" + (Opal.inspect(item)) + " doesn't respond to #to_str, #to_ary or #to_s", "to_str"));
      }

      if (sep === nil) {
        return result.join('');
      }
      else {
        return result.join($$($nesting, 'Opal')['$coerce_to!'](sep, $$($nesting, 'String'), "to_str").$to_s());
      }
    ;
    }, $Array_join$60.$$arity = -1);
    
    ;
    
    Opal.def(self, '$last', $Array_last$63 = function $$last(count) {
      var self = this;

      
      ;
      
      if (count == null) {
        return self.length === 0 ? nil : self[self.length - 1];
      }

      count = $$($nesting, 'Opal').$coerce_to(count, $$($nesting, 'Integer'), "to_int");

      if (count < 0) {
        self.$raise($$($nesting, 'ArgumentError'), "negative array size");
      }

      if (count > self.length) {
        count = self.length;
      }

      return self.slice(self.length - count, self.length);
    ;
    }, $Array_last$63.$$arity = -1);
    
    Opal.def(self, '$length', $Array_length$64 = function $$length() {
      var self = this;

      return self.length;
    }, $Array_length$64.$$arity = 0);
    Opal.alias(self, "map", "collect");
    ;
    
    ;
    
    Opal.def(self, '$min', $Array_min$66 = function $$min() {
      var $iter = $Array_min$66.$$p, block = $iter || nil, self = this;

      if ($iter) $Array_min$66.$$p = null;
      
      
      if ($iter) $Array_min$66.$$p = null;;
      return $send(self.$each(), 'min', [], block.$to_proc());
    }, $Array_min$66.$$arity = 0);
    
    // Returns the product of from, from-1, ..., from - how_many + 1.
   
  ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$replace', $Array_replace$79 = function $$replace(other) {
      var self = this;

      
      other = (function() {if ($truthy($$($nesting, 'Array')['$==='](other))) {
        return other.$to_a()
      } else {
        return $$($nesting, 'Opal').$coerce_to(other, $$($nesting, 'Array'), "to_ary").$to_a()
      }; return nil; })();
      
      self.splice(0, self.length);
      self.push.apply(self, other);
    ;
      return self;
    }, $Array_replace$79.$$arity = 1);
    
    ;
    
    Opal.def(self, '$reverse!', $Array_reverse$excl$81 = function() {
      var self = this;

      return self.reverse();
    }, $Array_reverse$excl$81.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    ;
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    Opal.alias(self, "size", "length");
    
    ;
    
    ;
    ;
    
    ;
    
    Opal.def(self, '$sort', $Array_sort$98 = function $$sort() {
      var $iter = $Array_sort$98.$$p, block = $iter || nil, self = this;

      if ($iter) $Array_sort$98.$$p = null;
      
      
      if ($iter) $Array_sort$98.$$p = null;;
      if ($truthy(self.length > 1)) {
      } else {
        return self
      };
      
      if (block === nil) {
        block = function(a, b) {
          return (a)['$<=>'](b);
        };
      }

      return self.slice().sort(function(x, y) {
        var ret = block(x, y);

        if (ret === nil) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "comparison of " + ((x).$inspect()) + " with " + ((y).$inspect()) + " failed");
        }

        return $rb_gt(ret, 0) ? 1 : ($rb_lt(ret, 0) ? -1 : 0);
      });
    ;
    }, $Array_sort$98.$$arity = 0);
    
    ;
    
    ;
    
    Opal.def(self, '$take', $Array_take$102 = function $$take(count) {
      var self = this;

      
      if (count < 0) {
        self.$raise($$($nesting, 'ArgumentError'));
      }

      return self.slice(0, count);
    
    }, $Array_take$102.$$arity = 1);
    
    ;
    
    Opal.def(self, '$to_a', $Array_to_a$104 = function $$to_a() {
      var self = this;

      return self
    }, $Array_to_a$104.$$arity = 0);
    Opal.alias(self, "to_ary", "to_a");
    
    ;
    Opal.alias(self, "to_s", "inspect");
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$unshift', $Array_unshift$111 = function $$unshift($a) {
      var $post_args, objects, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      objects = $post_args;;
      
      for (var i = objects.length - 1; i >= 0; i--) {
        self.unshift(objects[i]);
      }
    ;
      return self;
    }, $Array_unshift$111.$$arity = -1);
    ;
    
    ;
    
    ;
    Opal.defs(self, '$inherited', $Array_inherited$116 = function $$inherited(klass) {
      var self = this;

      
      klass.$$prototype.$to_a = function() {
        return this.slice(0, this.length);
      }
    
    }, $Array_inherited$116.$$arity = 1);
    
    ;
    $$($nesting, 'Opal').$pristine(self.$singleton_class(), "allocate");
    $$($nesting, 'Opal').$pristine(self, "copy_instance_variables", "initialize_dup");
    return ( nil) && 'pack';
  })($nesting[0], Array, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/hash"] = function(Opal) {
  function $rb_ge(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs >= rhs : lhs['$>='](rhs);
  }
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $send = Opal.send, $hash2 = Opal.hash2, $truthy = Opal.truthy;

  
  self.$require("corelib/enumerable");
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Hash');

    var $nesting = [self].concat($parent_nesting), $Hash_$$$1, $Hash_allocate$2, $Hash_try_convert$3, $Hash_initialize$4, $Hash_$eq_eq$5, $Hash_$gt_eq$6, $Hash_$gt$8, $Hash_$lt$9, $Hash_$lt_eq$10, $Hash_$$$11, $Hash_$$$eq$12, $Hash_assoc$13, $Hash_clear$14, $Hash_clone$15, $Hash_compact$16, $Hash_compact$excl$17, $Hash_compare_by_identity$18, $Hash_compare_by_identity$ques$19, $Hash_default$20, $Hash_default$eq$21, $Hash_default_proc$22, $Hash_default_proc$eq$23, $Hash_delete$24, $Hash_delete_if$25, $Hash_dig$27, $Hash_each$28, $Hash_each_key$30, $Hash_each_value$32, $Hash_empty$ques$34, $Hash_fetch$35, $Hash_fetch_values$36, $Hash_flatten$38, $Hash_has_key$ques$39, $Hash_has_value$ques$40, $Hash_hash$41, $Hash_index$42, $Hash_indexes$43, $Hash_inspect$44, $Hash_invert$45, $Hash_keep_if$46, $Hash_keys$48, $Hash_length$49, $Hash_merge$50, $Hash_merge$excl$51, $Hash_rassoc$52, $Hash_rehash$53, $Hash_reject$54, $Hash_reject$excl$56, $Hash_replace$58, $Hash_select$59, $Hash_select$excl$61, $Hash_shift$63, $Hash_slice$64, $Hash_to_a$65, $Hash_to_h$66, $Hash_to_hash$67, $Hash_to_proc$68, $Hash_transform_keys$70, $Hash_transform_keys$excl$72, $Hash_transform_values$74, $Hash_transform_values$excl$76, $Hash_values$78;

    
    self.$include($$($nesting, 'Enumerable'));
    self.$$prototype.$$is_hash = true;
    Opal.defs(self, '$[]', $Hash_$$$1 = function($a) {
      var $post_args, argv, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      argv = $post_args;;
      
      var hash, argc = argv.length, i;

      if (argc === 1) {
        hash = $$($nesting, 'Opal')['$coerce_to?'](argv['$[]'](0), $$($nesting, 'Hash'), "to_hash");
        if (hash !== nil) {
          return self.$allocate()['$merge!'](hash);
        }

        argv = $$($nesting, 'Opal')['$coerce_to?'](argv['$[]'](0), $$($nesting, 'Array'), "to_ary");
        if (argv === nil) {
          self.$raise($$($nesting, 'ArgumentError'), "odd number of arguments for Hash")
        }

        argc = argv.length;
        hash = self.$allocate();

        for (i = 0; i < argc; i++) {
          if (!argv[i].$$is_array) continue;
          switch(argv[i].length) {
          case 1:
            hash.$store(argv[i][0], nil);
            break;
          case 2:
            hash.$store(argv[i][0], argv[i][1]);
            break;
          default:
            self.$raise($$($nesting, 'ArgumentError'), "" + "invalid number of elements (" + (argv[i].length) + " for 1..2)")
          }
        }

        return hash;
      }

      if (argc % 2 !== 0) {
        self.$raise($$($nesting, 'ArgumentError'), "odd number of arguments for Hash")
      }

      hash = self.$allocate();

      for (i = 0; i < argc; i += 2) {
        hash.$store(argv[i], argv[i + 1]);
      }

      return hash;
    ;
    }, $Hash_$$$1.$$arity = -1);
    Opal.defs(self, '$allocate', $Hash_allocate$2 = function $$allocate() {
      var self = this;

      
      var hash = new self.$$constructor();

      Opal.hash_init(hash);

      hash.$$none = nil;
      hash.$$proc = nil;

      return hash;
    
    }, $Hash_allocate$2.$$arity = 0);
    ;
    
    Opal.def(self, '$initialize', $Hash_initialize$4 = function $$initialize(defaults) {
      var $iter = $Hash_initialize$4.$$p, block = $iter || nil, self = this;

      if ($iter) $Hash_initialize$4.$$p = null;
      
      
      if ($iter) $Hash_initialize$4.$$p = null;;
      ;
      
      if (defaults !== undefined && block !== nil) {
        self.$raise($$($nesting, 'ArgumentError'), "wrong number of arguments (1 for 0)")
      }
      self.$$none = (defaults === undefined ? nil : defaults);
      self.$$proc = block;

      return self;
    ;
    }, $Hash_initialize$4.$$arity = -1);
    
    Opal.def(self, '$==', $Hash_$eq_eq$5 = function(other) {
      var self = this;

      
      if (self === other) {
        return true;
      }

      if (!other.$$is_hash) {
        return false;
      }

      if (self.$$keys.length !== other.$$keys.length) {
        return false;
      }

      for (var i = 0, keys = self.$$keys, length = keys.length, key, value, other_value; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          value = self.$$smap[key];
          other_value = other.$$smap[key];
        } else {
          value = key.value;
          other_value = Opal.hash_get(other, key.key);
        }

        if (other_value === undefined || !value['$eql?'](other_value)) {
          return false;
        }
      }

      return true;
    
    }, $Hash_$eq_eq$5.$$arity = 1);
    
    Opal.def(self, '$>=', $Hash_$gt_eq$6 = function(other) {
      var $$7, self = this, result = nil;

      
      other = $$($nesting, 'Opal')['$coerce_to!'](other, $$($nesting, 'Hash'), "to_hash");
      
      if (self.$$keys.length < other.$$keys.length) {
        return false
      }
    ;
      result = true;
      $send(other, 'each', [], ($$7 = function(other_key, other_val){var self = $$7.$$s == null ? this : $$7.$$s, val = nil;

      
        
        if (other_key == null) {
          other_key = nil;
        };
        
        if (other_val == null) {
          other_val = nil;
        };
        val = self.$fetch(other_key, null);
        
        if (val == null || val !== other_val) {
          result = false;
          return;
        }
      ;}, $$7.$$s = self, $$7.$$arity = 2, $$7));
      return result;
    }, $Hash_$gt_eq$6.$$arity = 1);
    
    Opal.def(self, '$>', $Hash_$gt$8 = function(other) {
      var self = this;

      
      other = $$($nesting, 'Opal')['$coerce_to!'](other, $$($nesting, 'Hash'), "to_hash");
      
      if (self.$$keys.length <= other.$$keys.length) {
        return false
      }
    ;
      return $rb_ge(self, other);
    }, $Hash_$gt$8.$$arity = 1);
    
    Opal.def(self, '$<', $Hash_$lt$9 = function(other) {
      var self = this;

      
      other = $$($nesting, 'Opal')['$coerce_to!'](other, $$($nesting, 'Hash'), "to_hash");
      return $rb_gt(other, self);
    }, $Hash_$lt$9.$$arity = 1);
    
    Opal.def(self, '$<=', $Hash_$lt_eq$10 = function(other) {
      var self = this;

      
      other = $$($nesting, 'Opal')['$coerce_to!'](other, $$($nesting, 'Hash'), "to_hash");
      return $rb_ge(other, self);
    }, $Hash_$lt_eq$10.$$arity = 1);
    
    Opal.def(self, '$[]', $Hash_$$$11 = function(key) {
      var self = this;

      
      var value = Opal.hash_get(self, key);

      if (value !== undefined) {
        return value;
      }

      return self.$default(key);
    
    }, $Hash_$$$11.$$arity = 1);
    
    Opal.def(self, '$[]=', $Hash_$$$eq$12 = function(key, value) {
      var self = this;

      
      Opal.hash_put(self, key, value);
      return value;
    
    }, $Hash_$$$eq$12.$$arity = 2);
    
    ;
    
    ;
    
    Opal.def(self, '$clone', $Hash_clone$15 = function $$clone() {
      var self = this;

      
      var hash = new self.$$class();

      Opal.hash_init(hash);
      Opal.hash_clone(self, hash);

      return hash;
    
    }, $Hash_clone$15.$$arity = 0);
    
    ;
    
    ;
    
    Opal.def(self, '$compare_by_identity', $Hash_compare_by_identity$18 = function $$compare_by_identity() {
      var self = this;

      
      var i, ii, key, keys = self.$$keys, identity_hash;

      if (self.$$by_identity) return self;
      if (self.$$keys.length === 0) {
        self.$$by_identity = true
        return self;
      }

      identity_hash = $hash2([], {}).$compare_by_identity();
      for(i = 0, ii = keys.length; i < ii; i++) {
        key = keys[i];
        if (!key.$$is_string) key = key.key;
        Opal.hash_put(identity_hash, key, Opal.hash_get(self, key));
      }

      self.$$by_identity = true;
      self.$$map = identity_hash.$$map;
      self.$$smap = identity_hash.$$smap;
      return self;
    
    }, $Hash_compare_by_identity$18.$$arity = 0);
    
    ;
    
    Opal.def(self, '$default', $Hash_default$20 = function(key) {
      var self = this;

      
      ;
      
      if (key !== undefined && self.$$proc !== nil && self.$$proc !== undefined) {
        return self.$$proc.$call(self, key);
      }
      if (self.$$none === undefined) {
        return nil;
      }
      return self.$$none;
    ;
    }, $Hash_default$20.$$arity = -1);
    
    Opal.def(self, '$default=', $Hash_default$eq$21 = function(object) {
      var self = this;

      
      self.$$proc = nil;
      self.$$none = object;

      return object;
    
    }, $Hash_default$eq$21.$$arity = 1);
    
    Opal.def(self, '$default_proc', $Hash_default_proc$22 = function $$default_proc() {
      var self = this;

      
      if (self.$$proc !== undefined) {
        return self.$$proc;
      }
      return nil;
    
    }, $Hash_default_proc$22.$$arity = 0);
    
    Opal.def(self, '$default_proc=', $Hash_default_proc$eq$23 = function(default_proc) {
      var self = this;

      
      var proc = default_proc;

      if (proc !== nil) {
        proc = $$($nesting, 'Opal')['$coerce_to!'](proc, $$($nesting, 'Proc'), "to_proc");

        if ((proc)['$lambda?']() && (proc).$arity().$abs() !== 2) {
          self.$raise($$($nesting, 'TypeError'), "default_proc takes two arguments");
        }
      }

      self.$$none = nil;
      self.$$proc = proc;

      return default_proc;
    
    }, $Hash_default_proc$eq$23.$$arity = 1);
    
    ;
    
    ;
    Opal.alias(self, "dup", "clone");
    
    Opal.def(self, '$dig', $Hash_dig$27 = function $$dig(key, $a) {
      var $post_args, keys, self = this, item = nil;

      
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      keys = $post_args;;
      item = self['$[]'](key);
      
      if (item === nil || keys.length === 0) {
        return item;
      }
    ;
      if ($truthy(item['$respond_to?']("dig"))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "" + (item.$class()) + " does not have #dig method")
      };
      return $send(item, 'dig', Opal.to_a(keys));
    }, $Hash_dig$27.$$arity = -2);
    
    Opal.def(self, '$each', $Hash_each$28 = function $$each() {
      var $iter = $Hash_each$28.$$p, block = $iter || nil, $$29, self = this;

      if ($iter) $Hash_each$28.$$p = null;
      
      
      if ($iter) $Hash_each$28.$$p = null;;
      if ($truthy(block)) {
      } else {
        return $send(self, 'enum_for', ["each"], ($$29 = function(){var self = $$29.$$s == null ? this : $$29.$$s;

        return self.$size()}, $$29.$$s = self, $$29.$$arity = 0, $$29))
      };
      
      for (var i = 0, keys = self.$$keys, length = keys.length, key, value; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          value = self.$$smap[key];
        } else {
          value = key.value;
          key = key.key;
        }

        Opal.yield1(block, [key, value]);
      }

      return self;
    ;
    }, $Hash_each$28.$$arity = 0);
    
    ;
    Opal.alias(self, "each_pair", "each");
    
    ;
    
    Opal.def(self, '$empty?', $Hash_empty$ques$34 = function() {
      var self = this;

      return self.$$keys.length === 0;
    }, $Hash_empty$ques$34.$$arity = 0);
    Opal.alias(self, "eql?", "==");
    
    Opal.def(self, '$fetch', $Hash_fetch$35 = function $$fetch(key, defaults) {
      var $iter = $Hash_fetch$35.$$p, block = $iter || nil, self = this;

      if ($iter) $Hash_fetch$35.$$p = null;
      
      
      if ($iter) $Hash_fetch$35.$$p = null;;
      ;
      
      var value = Opal.hash_get(self, key);

      if (value !== undefined) {
        return value;
      }

      if (block !== nil) {
        return block(key);
      }

      if (defaults !== undefined) {
        return defaults;
      }
    ;
      return self.$raise($$($nesting, 'KeyError').$new("" + "key not found: " + (key.$inspect()), $hash2(["key", "receiver"], {"key": key, "receiver": self})));
    }, $Hash_fetch$35.$$arity = -2);
    
    ;
    
    Opal.def(self, '$flatten', $Hash_flatten$38 = function $$flatten(level) {
      var self = this;

      
      
      if (level == null) {
        level = 1;
      };
      level = $$($nesting, 'Opal')['$coerce_to!'](level, $$($nesting, 'Integer'), "to_int");
      
      var result = [];

      for (var i = 0, keys = self.$$keys, length = keys.length, key, value; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          value = self.$$smap[key];
        } else {
          value = key.value;
          key = key.key;
        }

        result.push(key);

        if (value.$$is_array) {
          if (level === 1) {
            result.push(value);
            continue;
          }

          result = result.concat((value).$flatten(level - 2));
          continue;
        }

        result.push(value);
      }

      return result;
    ;
    }, $Hash_flatten$38.$$arity = -1);
    
    Opal.def(self, '$has_key?', $Hash_has_key$ques$39 = function(key) {
      var self = this;

      return Opal.hash_get(self, key) !== undefined;
    }, $Hash_has_key$ques$39.$$arity = 1);
    
    ;
    
    Opal.def(self, '$hash', $Hash_hash$41 = function $$hash() {
      var self = this;

      
      var top = (Opal.hash_ids === undefined),
          hash_id = self.$object_id(),
          result = ['Hash'],
          key, item;

      try {
        if (top) {
          Opal.hash_ids = Object.create(null);
        }

        if (Opal[hash_id]) {
          return 'self';
        }

        for (key in Opal.hash_ids) {
          item = Opal.hash_ids[key];
          if (self['$eql?'](item)) {
            return 'self';
          }
        }

        Opal.hash_ids[hash_id] = self;

        for (var i = 0, keys = self.$$keys, length = keys.length; i < length; i++) {
          key = keys[i];

          if (key.$$is_string) {
            result.push([key, self.$$smap[key].$hash()]);
          } else {
            result.push([key.key_hash, key.value.$hash()]);
          }
        }

        return result.sort().join();

      } finally {
        if (top) {
          Opal.hash_ids = undefined;
        }
      }
    
    }, $Hash_hash$41.$$arity = 0);
    Opal.alias(self, "include?", "has_key?");
    
    ;
    
    ;
    ;
    var inspect_ids;
    
    Opal.def(self, '$inspect', $Hash_inspect$44 = function $$inspect() {
      var self = this;

      
      var top = (inspect_ids === undefined),
          hash_id = self.$object_id(),
          result = [];

      try {
        if (top) {
          inspect_ids = {};
        }

        if (inspect_ids.hasOwnProperty(hash_id)) {
          return '{...}';
        }

        inspect_ids[hash_id] = true;

        for (var i = 0, keys = self.$$keys, length = keys.length, key, value; i < length; i++) {
          key = keys[i];

          if (key.$$is_string) {
            value = self.$$smap[key];
          } else {
            value = key.value;
            key = key.key;
          }

          result.push(key.$inspect() + '=>' + value.$inspect());
        }

        return '{' + result.join(', ') + '}';

      } finally {
        if (top) {
          inspect_ids = undefined;
        }
      }
    
    }, $Hash_inspect$44.$$arity = 0);
    
    ;
    
    ;
    ;
    ;
    
    Opal.def(self, '$keys', $Hash_keys$48 = function $$keys() {
      var self = this;

      
      var result = [];

      for (var i = 0, keys = self.$$keys, length = keys.length, key; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          result.push(key);
        } else {
          result.push(key.key);
        }
      }

      return result;
    
    }, $Hash_keys$48.$$arity = 0);
    
    Opal.def(self, '$length', $Hash_length$49 = function $$length() {
      var self = this;

      return self.$$keys.length;
    }, $Hash_length$49.$$arity = 0);
    ;
    
    Opal.def(self, '$merge', $Hash_merge$50 = function $$merge(other) {
      var $iter = $Hash_merge$50.$$p, block = $iter || nil, self = this;

      if ($iter) $Hash_merge$50.$$p = null;
      
      
      if ($iter) $Hash_merge$50.$$p = null;;
      return $send(self.$dup(), 'merge!', [other], block.$to_proc());
    }, $Hash_merge$50.$$arity = 1);
    
    Opal.def(self, '$merge!', $Hash_merge$excl$51 = function(other) {
      var $iter = $Hash_merge$excl$51.$$p, block = $iter || nil, self = this;

      if ($iter) $Hash_merge$excl$51.$$p = null;
      
      
      if ($iter) $Hash_merge$excl$51.$$p = null;;
      
      if (!other.$$is_hash) {
        other = $$($nesting, 'Opal')['$coerce_to!'](other, $$($nesting, 'Hash'), "to_hash");
      }

      var i, other_keys = other.$$keys, length = other_keys.length, key, value, other_value;

      if (block === nil) {
        for (i = 0; i < length; i++) {
          key = other_keys[i];

          if (key.$$is_string) {
            other_value = other.$$smap[key];
          } else {
            other_value = key.value;
            key = key.key;
          }

          Opal.hash_put(self, key, other_value);
        }

        return self;
      }

      for (i = 0; i < length; i++) {
        key = other_keys[i];

        if (key.$$is_string) {
          other_value = other.$$smap[key];
        } else {
          other_value = key.value;
          key = key.key;
        }

        value = Opal.hash_get(self, key);

        if (value === undefined) {
          Opal.hash_put(self, key, other_value);
          continue;
        }

        Opal.hash_put(self, key, block(key, value, other_value));
      }

      return self;
    ;
    }, $Hash_merge$excl$51.$$arity = 1);
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$replace', $Hash_replace$58 = function $$replace(other) {
      var self = this, $writer = nil;

      
      other = $$($nesting, 'Opal')['$coerce_to!'](other, $$($nesting, 'Hash'), "to_hash");
      
      Opal.hash_init(self);

      for (var i = 0, other_keys = other.$$keys, length = other_keys.length, key, value, other_value; i < length; i++) {
        key = other_keys[i];

        if (key.$$is_string) {
          other_value = other.$$smap[key];
        } else {
          other_value = key.value;
          key = key.key;
        }

        Opal.hash_put(self, key, other_value);
      }
    ;
      if ($truthy(other.$default_proc())) {
        
        $writer = [other.$default_proc()];
        $send(self, 'default_proc=', Opal.to_a($writer));
        $writer[$rb_minus($writer["length"], 1)];
      } else {
        
        $writer = [other.$default()];
        $send(self, 'default=', Opal.to_a($writer));
        $writer[$rb_minus($writer["length"], 1)];
      };
      return self;
    }, $Hash_replace$58.$$arity = 1);
    
    ;
    
    ;
    
    ;
    Opal.alias(self, "size", "length");
    
    ;
    Opal.alias(self, "store", "[]=");
    
    Opal.def(self, '$to_a', $Hash_to_a$65 = function $$to_a() {
      var self = this;

      
      var result = [];

      for (var i = 0, keys = self.$$keys, length = keys.length, key, value; i < length; i++) {
        key = keys[i];

        if (key.$$is_string) {
          value = self.$$smap[key];
        } else {
          value = key.value;
          key = key.key;
        }

        result.push([key, value]);
      }

      return result;
    
    }, $Hash_to_a$65.$$arity = 0);
    
    ;
    
    Opal.def(self, '$to_hash', $Hash_to_hash$67 = function $$to_hash() {
      var self = this;

      return self
    }, $Hash_to_hash$67.$$arity = 0);
    
    Opal.def(self, '$to_proc', $Hash_to_proc$68 = function $$to_proc() {
      var $$69, self = this;

      return $send(self, 'proc', [], ($$69 = function(key){var self = $$69.$$s == null ? this : $$69.$$s;

      
        ;
        
        if (key == null) {
          self.$raise($$($nesting, 'ArgumentError'), "no key given")
        }
      ;
        return self['$[]'](key);}, $$69.$$s = self, $$69.$$arity = -1, $$69))
    }, $Hash_to_proc$68.$$arity = 0);
    Opal.alias(self, "to_s", "inspect");
    
    ;
    
    ;
    
    ;
    
    ;
    ;
    ;
    ;
    return ( nil) && 'values';
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/number"] = function(Opal) {
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  function $rb_times(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs * rhs : lhs['$*'](rhs);
  }
  function $rb_le(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs <= rhs : lhs['$<='](rhs);
  }
  function $rb_ge(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs >= rhs : lhs['$>='](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $send = Opal.send, $hash2 = Opal.hash2;

  
  self.$require("corelib/numeric");
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Number');

    var $nesting = [self].concat($parent_nesting), $Number_coerce$2, $Number___id__$3, $Number_$plus$4, $Number_$minus$5, $Number_$$6, $Number_$slash$7, $Number_$percent$8, $Number_$$9, $Number_$$10, $Number_$$11, $Number_$lt$12, $Number_$lt_eq$13, $Number_$gt$14, $Number_$gt_eq$15, $Number_$lt_eq_gt$16, $Number_$lt$lt$17, $Number_$gt$gt$18, $Number_$$$19, $Number_$plus$$20, $Number_$minus$$21, $Number_$$22, $Number_$$$23, $Number_$eq_eq_eq$24, $Number_$eq_eq$25, $Number_abs$26, $Number_abs2$27, $Number_allbits$ques$28, $Number_anybits$ques$29, $Number_angle$30, $Number_bit_length$31, $Number_ceil$32, $Number_chr$33, $Number_denominator$34, $Number_downto$35, $Number_equal$ques$37, $Number_even$ques$38, $Number_floor$39, $Number_gcd$40, $Number_gcdlcm$41, $Number_integer$ques$42, $Number_is_a$ques$43, $Number_instance_of$ques$44, $Number_lcm$45, $Number_next$46, $Number_nobits$ques$47, $Number_nonzero$ques$48, $Number_numerator$49, $Number_odd$ques$50, $Number_ord$51, $Number_pow$52, $Number_pred$53, $Number_quo$54, $Number_rationalize$55, $Number_remainder$56, $Number_round$57, $Number_step$58, $Number_times$60, $Number_to_f$62, $Number_to_i$63, $Number_to_r$64, $Number_to_s$65, $Number_truncate$66, $Number_digits$67, $Number_divmod$68, $Number_upto$69, $Number_zero$ques$71, $Number_size$72, $Number_nan$ques$73, $Number_finite$ques$74, $Number_infinite$ques$75, $Number_positive$ques$76, $Number_negative$ques$77;

    
    $$($nesting, 'Opal').$bridge(Number, self);
    Opal.defineProperty(self.$$prototype, '$$is_number', true);
    self.$$is_number_class = true;
    (function(self, $parent_nesting) {
      var $nesting = [self].concat($parent_nesting), $allocate$1;

      
      
      Opal.def(self, '$allocate', $allocate$1 = function $$allocate() {
        var self = this;

        return self.$raise($$($nesting, 'TypeError'), "" + "allocator undefined for " + (self.$name()))
      }, $allocate$1.$$arity = 0);
      
      
      Opal.udef(self, '$' + "new");;
      return nil;;
    })(Opal.get_singleton_class(self), $nesting);
    
    Opal.def(self, '$coerce', $Number_coerce$2 = function $$coerce(other) {
      var self = this;

      
      if (other === nil) {
        self.$raise($$($nesting, 'TypeError'), "" + "can't convert " + (other.$class()) + " into Float");
      }
      else if (other.$$is_string) {
        return [self.$Float(other), self];
      }
      else if (other['$respond_to?']("to_f")) {
        return [$$($nesting, 'Opal')['$coerce_to!'](other, $$($nesting, 'Float'), "to_f"), self];
      }
      else if (other.$$is_number) {
        return [other, self];
      }
      else {
        self.$raise($$($nesting, 'TypeError'), "" + "can't convert " + (other.$class()) + " into Float");
      }
    
    }, $Number_coerce$2.$$arity = 1);
    
    Opal.def(self, '$__id__', $Number___id__$3 = function $$__id__() {
      var self = this;

      return (self * 2) + 1;
    }, $Number___id__$3.$$arity = 0);
    Opal.alias(self, "object_id", "__id__");
    
    Opal.def(self, '$+', $Number_$plus$4 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self + other;
      }
      else {
        return self.$__coerced__("+", other);
      }
    
    }, $Number_$plus$4.$$arity = 1);
    
    Opal.def(self, '$-', $Number_$minus$5 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self - other;
      }
      else {
        return self.$__coerced__("-", other);
      }
    
    }, $Number_$minus$5.$$arity = 1);
    
    Opal.def(self, '$*', $Number_$$6 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self * other;
      }
      else {
        return self.$__coerced__("*", other);
      }
    
    }, $Number_$$6.$$arity = 1);
    
    Opal.def(self, '$/', $Number_$slash$7 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self / other;
      }
      else {
        return self.$__coerced__("/", other);
      }
    
    }, $Number_$slash$7.$$arity = 1);
    ;
    
    Opal.def(self, '$%', $Number_$percent$8 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        if (other == -Infinity) {
          return other;
        }
        else if (other == 0) {
          self.$raise($$($nesting, 'ZeroDivisionError'), "divided by 0");
        }
        else if (other < 0 || self < 0) {
          return (self % other + other) % other;
        }
        else {
          return self % other;
        }
      }
      else {
        return self.$__coerced__("%", other);
      }
    
    }, $Number_$percent$8.$$arity = 1);
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$<', $Number_$lt$12 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self < other;
      }
      else {
        return self.$__coerced__("<", other);
      }
    
    }, $Number_$lt$12.$$arity = 1);
    
    Opal.def(self, '$<=', $Number_$lt_eq$13 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self <= other;
      }
      else {
        return self.$__coerced__("<=", other);
      }
    
    }, $Number_$lt_eq$13.$$arity = 1);
    
    Opal.def(self, '$>', $Number_$gt$14 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self > other;
      }
      else {
        return self.$__coerced__(">", other);
      }
    
    }, $Number_$gt$14.$$arity = 1);
    
    Opal.def(self, '$>=', $Number_$gt_eq$15 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self >= other;
      }
      else {
        return self.$__coerced__(">=", other);
      }
    
    }, $Number_$gt_eq$15.$$arity = 1);
    
    var spaceship_operator = function(self, other) {
      if (other.$$is_number) {
        if (isNaN(self) || isNaN(other)) {
          return nil;
        }

        if (self > other) {
          return 1;
        } else if (self < other) {
          return -1;
        } else {
          return 0;
        }
      }
      else {
        return self.$__coerced__("<=>", other);
      }
    }
  ;
    
    Opal.def(self, '$<=>', $Number_$lt_eq_gt$16 = function(other) {
      var self = this;

      try {
        return spaceship_operator(self, other);
      } catch ($err) {
        if (Opal.rescue($err, [$$($nesting, 'ArgumentError')])) {
          try {
            return nil
          } finally { Opal.pop_exception() }
        } else { throw $err; }
      }
    }, $Number_$lt_eq_gt$16.$$arity = 1);
    
    Opal.def(self, '$<<', $Number_$lt$lt$17 = function(count) {
      var self = this;

      
      count = $$($nesting, 'Opal')['$coerce_to!'](count, $$($nesting, 'Integer'), "to_int");
      return count > 0 ? self << count : self >> -count;
    }, $Number_$lt$lt$17.$$arity = 1);
    
    ;
    
    Opal.def(self, '$[]', $Number_$$$19 = function(bit) {
      var self = this;

      
      bit = $$($nesting, 'Opal')['$coerce_to!'](bit, $$($nesting, 'Integer'), "to_int");
      
      if (bit < 0) {
        return 0;
      }
      if (bit >= 32) {
        return self < 0 ? 1 : 0;
      }
      return (self >> bit) & 1;
    ;
    }, $Number_$$$19.$$arity = 1);
    
    ;
    
    Opal.def(self, '$-@', $Number_$minus$$21 = function() {
      var self = this;

      return -self;
    }, $Number_$minus$$21.$$arity = 0);
    
    ;
    
    Opal.def(self, '$**', $Number_$$$23 = function(other) {
      var $a, $b, self = this;

      if ($truthy($$($nesting, 'Integer')['$==='](other))) {
        if ($truthy(($truthy($a = $$($nesting, 'Integer')['$==='](self)['$!']()) ? $a : $rb_gt(other, 0)))) {
          return Math.pow(self, other);
        } else {
          return $$($nesting, 'Rational').$new(self, 1)['$**'](other)
        }
      } else if ($truthy((($a = $rb_lt(self, 0)) ? ($truthy($b = $$($nesting, 'Float')['$==='](other)) ? $b : $$($nesting, 'Rational')['$==='](other)) : $rb_lt(self, 0)))) {
        return $$($nesting, 'Complex').$new(self, 0)['$**'](other.$to_f())
      } else if ($truthy(other.$$is_number != null)) {
        return Math.pow(self, other);
      } else {
        return self.$__coerced__("**", other)
      }
    }, $Number_$$$23.$$arity = 1);
    
    Opal.def(self, '$===', $Number_$eq_eq_eq$24 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self.valueOf() === other.valueOf();
      }
      else if (other['$respond_to?']("==")) {
        return other['$=='](self);
      }
      else {
        return false;
      }
    
    }, $Number_$eq_eq_eq$24.$$arity = 1);
    
    Opal.def(self, '$==', $Number_$eq_eq$25 = function(other) {
      var self = this;

      
      if (other.$$is_number) {
        return self.valueOf() === other.valueOf();
      }
      else if (other['$respond_to?']("==")) {
        return other['$=='](self);
      }
      else {
        return false;
      }
    
    }, $Number_$eq_eq$25.$$arity = 1);
    
    Opal.def(self, '$abs', $Number_abs$26 = function $$abs() {
      var self = this;

      return Math.abs(self);
    }, $Number_abs$26.$$arity = 0);
    
    Opal.def(self, '$abs2', $Number_abs2$27 = function $$abs2() {
      var self = this;

      return Math.abs(self * self);
    }, $Number_abs2$27.$$arity = 0);
    
    ;
    
    ;
    
    Opal.def(self, '$angle', $Number_angle$30 = function $$angle() {
      var self = this;

      
      if ($truthy(self['$nan?']())) {
        return self};
      
      if (self == 0) {
        if (1 / self > 0) {
          return 0;
        }
        else {
          return Math.PI;
        }
      }
      else if (self < 0) {
        return Math.PI;
      }
      else {
        return 0;
      }
    ;
    }, $Number_angle$30.$$arity = 0);
    Opal.alias(self, "arg", "angle");
    ;
    
    ;
    
    Opal.def(self, '$ceil', $Number_ceil$32 = function $$ceil(ndigits) {
      var self = this;

      
      
      if (ndigits == null) {
        ndigits = 0;
      };
      
      var f = self.$to_f();

      if (f % 1 === 0 && ndigits >= 0) {
        return f;
      }

      var factor = Math.pow(10, ndigits),
          result = Math.ceil(f * factor) / factor;

      if (f % 1 === 0) {
        result = Math.round(result);
      }

      return result;
    ;
    }, $Number_ceil$32.$$arity = -1);
    
    Opal.def(self, '$chr', $Number_chr$33 = function $$chr(encoding) {
      var self = this;

      
      ;
      return String.fromCharCode(self);;
    }, $Number_chr$33.$$arity = -1);
    
    Opal.def(self, '$denominator', $Number_denominator$34 = function $$denominator() {
      var $a, $iter = $Number_denominator$34.$$p, $yield = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Number_denominator$34.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      if ($truthy(($truthy($a = self['$nan?']()) ? $a : self['$infinite?']()))) {
        return 1
      } else {
        return $send(self, Opal.find_super_dispatcher(self, 'denominator', $Number_denominator$34, false), $zuper, $iter)
      }
    }, $Number_denominator$34.$$arity = 0);
    
    ;
    Opal.alias(self, "eql?", "==");
    
    Opal.def(self, '$equal?', $Number_equal$ques$37 = function(other) {
      var $a, self = this;

      return ($truthy($a = self['$=='](other)) ? $a : isNaN(self) && isNaN(other))
    }, $Number_equal$ques$37.$$arity = 1);
    
    ;
    
    Opal.def(self, '$floor', $Number_floor$39 = function $$floor(ndigits) {
      var self = this;

      
      
      if (ndigits == null) {
        ndigits = 0;
      };
      
      var f = self.$to_f();

      if (f % 1 === 0 && ndigits >= 0) {
        return f;
      }

      var factor = Math.pow(10, ndigits),
          result = Math.floor(f * factor) / factor;

      if (f % 1 === 0) {
        result = Math.round(result);
      }

      return result;
    ;
    }, $Number_floor$39.$$arity = -1);
    
    Opal.def(self, '$gcd', $Number_gcd$40 = function $$gcd(other) {
      var self = this;

      
      if ($truthy($$($nesting, 'Integer')['$==='](other))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "not an integer")
      };
      
      var min = Math.abs(self),
          max = Math.abs(other);

      while (min > 0) {
        var tmp = min;

        min = max % min;
        max = tmp;
      }

      return max;
    ;
    }, $Number_gcd$40.$$arity = 1);
    
    ;
    
    ;
    
    Opal.def(self, '$is_a?', $Number_is_a$ques$43 = function(klass) {
      var $a, $iter = $Number_is_a$ques$43.$$p, $yield = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Number_is_a$ques$43.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      
      if ($truthy((($a = klass['$==']($$($nesting, 'Integer'))) ? $$($nesting, 'Integer')['$==='](self) : klass['$==']($$($nesting, 'Integer'))))) {
        return true};
      if ($truthy((($a = klass['$==']($$($nesting, 'Integer'))) ? $$($nesting, 'Integer')['$==='](self) : klass['$==']($$($nesting, 'Integer'))))) {
        return true};
      if ($truthy((($a = klass['$==']($$($nesting, 'Float'))) ? $$($nesting, 'Float')['$==='](self) : klass['$==']($$($nesting, 'Float'))))) {
        return true};
      return $send(self, Opal.find_super_dispatcher(self, 'is_a?', $Number_is_a$ques$43, false), $zuper, $iter);
    }, $Number_is_a$ques$43.$$arity = 1);
    ;
    
    Opal.def(self, '$instance_of?', $Number_instance_of$ques$44 = function(klass) {
      var $a, $iter = $Number_instance_of$ques$44.$$p, $yield = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Number_instance_of$ques$44.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      
      if ($truthy((($a = klass['$==']($$($nesting, 'Integer'))) ? $$($nesting, 'Integer')['$==='](self) : klass['$==']($$($nesting, 'Integer'))))) {
        return true};
      if ($truthy((($a = klass['$==']($$($nesting, 'Integer'))) ? $$($nesting, 'Integer')['$==='](self) : klass['$==']($$($nesting, 'Integer'))))) {
        return true};
      if ($truthy((($a = klass['$==']($$($nesting, 'Float'))) ? $$($nesting, 'Float')['$==='](self) : klass['$==']($$($nesting, 'Float'))))) {
        return true};
      return $send(self, Opal.find_super_dispatcher(self, 'instance_of?', $Number_instance_of$ques$44, false), $zuper, $iter);
    }, $Number_instance_of$ques$44.$$arity = 1);
    
    Opal.def(self, '$lcm', $Number_lcm$45 = function $$lcm(other) {
      var self = this;

      
      if ($truthy($$($nesting, 'Integer')['$==='](other))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "not an integer")
      };
      
      if (self == 0 || other == 0) {
        return 0;
      }
      else {
        return Math.abs(self * other / self.$gcd(other));
      }
    ;
    }, $Number_lcm$45.$$arity = 1);
    ;
    ;
    
    Opal.def(self, '$next', $Number_next$46 = function $$next() {
      var self = this;

      return self + 1;
    }, $Number_next$46.$$arity = 0);
    
    ;
    
    ;
    
    Opal.def(self, '$numerator', $Number_numerator$49 = function $$numerator() {
      var $a, $iter = $Number_numerator$49.$$p, $yield = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Number_numerator$49.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      if ($truthy(($truthy($a = self['$nan?']()) ? $a : self['$infinite?']()))) {
        return self
      } else {
        return $send(self, Opal.find_super_dispatcher(self, 'numerator', $Number_numerator$49, false), $zuper, $iter)
      }
    }, $Number_numerator$49.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$quo', $Number_quo$54 = function $$quo(other) {
      var $iter = $Number_quo$54.$$p, $yield = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Number_quo$54.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      if ($truthy($$($nesting, 'Integer')['$==='](self))) {
        return $send(self, Opal.find_super_dispatcher(self, 'quo', $Number_quo$54, false), $zuper, $iter)
      } else {
        return $rb_divide(self, other)
      }
    }, $Number_quo$54.$$arity = 1);
    
    Opal.def(self, '$rationalize', $Number_rationalize$55 = function $$rationalize(eps) {
      var $a, $b, self = this, f = nil, n = nil;

      
      ;
      
      if (arguments.length > 1) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "wrong number of arguments (" + (arguments.length) + " for 0..1)");
      }
    ;
      if ($truthy($$($nesting, 'Integer')['$==='](self))) {
        return $$($nesting, 'Rational').$new(self, 1)
      } else if ($truthy(self['$infinite?']())) {
        return self.$raise($$($nesting, 'FloatDomainError'), "Infinity")
      } else if ($truthy(self['$nan?']())) {
        return self.$raise($$($nesting, 'FloatDomainError'), "NaN")
      } else if ($truthy(eps == null)) {
        
        $b = $$($nesting, 'Math').$frexp(self), $a = Opal.to_ary($b), (f = ($a[0] == null ? nil : $a[0])), (n = ($a[1] == null ? nil : $a[1])), $b;
        f = $$($nesting, 'Math').$ldexp(f, $$$($$($nesting, 'Float'), 'MANT_DIG')).$to_i();
        n = $rb_minus(n, $$$($$($nesting, 'Float'), 'MANT_DIG'));
        return $$($nesting, 'Rational').$new($rb_times(2, f), (1)['$<<']($rb_minus(1, n))).$rationalize($$($nesting, 'Rational').$new(1, (1)['$<<']($rb_minus(1, n))));
      } else {
        return self.$to_r().$rationalize(eps)
      };
    }, $Number_rationalize$55.$$arity = -1);
    
    ;
    
    Opal.def(self, '$round', $Number_round$57 = function $$round(ndigits) {
      var $a, $b, self = this, _ = nil, exp = nil;

      
      ;
      if ($truthy($$($nesting, 'Integer')['$==='](self))) {
        
        if ($truthy(ndigits == null)) {
          return self};
        if ($truthy(($truthy($a = $$($nesting, 'Float')['$==='](ndigits)) ? ndigits['$infinite?']() : $a))) {
          self.$raise($$($nesting, 'RangeError'), "Infinity")};
        ndigits = $$($nesting, 'Opal')['$coerce_to!'](ndigits, $$($nesting, 'Integer'), "to_int");
        if ($truthy($rb_lt(ndigits, $$$($$($nesting, 'Integer'), 'MIN')))) {
          self.$raise($$($nesting, 'RangeError'), "out of bounds")};
        if ($truthy(ndigits >= 0)) {
          return self};
        ndigits = ndigits['$-@']();
        
        if (0.415241 * ndigits - 0.125 > self.$size()) {
          return 0;
        }

        var f = Math.pow(10, ndigits),
            x = Math.floor((Math.abs(self) + f / 2) / f) * f;

        return self < 0 ? -x : x;
      ;
      } else {
        
        if ($truthy(($truthy($a = self['$nan?']()) ? ndigits == null : $a))) {
          self.$raise($$($nesting, 'FloatDomainError'), "NaN")};
        ndigits = $$($nesting, 'Opal')['$coerce_to!'](ndigits || 0, $$($nesting, 'Integer'), "to_int");
        if ($truthy($rb_le(ndigits, 0))) {
          if ($truthy(self['$nan?']())) {
            self.$raise($$($nesting, 'RangeError'), "NaN")
          } else if ($truthy(self['$infinite?']())) {
            self.$raise($$($nesting, 'FloatDomainError'), "Infinity")}
        } else if (ndigits['$=='](0)) {
          return Math.round(self)
        } else if ($truthy(($truthy($a = self['$nan?']()) ? $a : self['$infinite?']()))) {
          return self};
        $b = $$($nesting, 'Math').$frexp(self), $a = Opal.to_ary($b), (_ = ($a[0] == null ? nil : $a[0])), (exp = ($a[1] == null ? nil : $a[1])), $b;
        if ($truthy($rb_ge(ndigits, $rb_minus($rb_plus($$$($$($nesting, 'Float'), 'DIG'), 2), (function() {if ($truthy($rb_gt(exp, 0))) {
          return $rb_divide(exp, 4)
        } else {
          return $rb_minus($rb_divide(exp, 3), 1)
        }; return nil; })())))) {
          return self};
        if ($truthy($rb_lt(ndigits, (function() {if ($truthy($rb_gt(exp, 0))) {
          return $rb_plus($rb_divide(exp, 3), 1)
        } else {
          return $rb_divide(exp, 4)
        }; return nil; })()['$-@']()))) {
          return 0};
        return Math.round(self * Math.pow(10, ndigits)) / Math.pow(10, ndigits);;
      };
    }, $Number_round$57.$$arity = -1);
    
    ;
    Opal.alias(self, "succ", "next");
    
    ;
    
    Opal.def(self, '$to_f', $Number_to_f$62 = function $$to_f() {
      var self = this;

      return self
    }, $Number_to_f$62.$$arity = 0);
    
    Opal.def(self, '$to_i', $Number_to_i$63 = function $$to_i() {
      var self = this;

      return parseInt(self, 10);
    }, $Number_to_i$63.$$arity = 0);
    Opal.alias(self, "to_int", "to_i");
    
    Opal.def(self, '$to_r', $Number_to_r$64 = function $$to_r() {
      var $a, $b, self = this, f = nil, e = nil;

      if ($truthy($$($nesting, 'Integer')['$==='](self))) {
        return $$($nesting, 'Rational').$new(self, 1)
      } else {
        
        $b = $$($nesting, 'Math').$frexp(self), $a = Opal.to_ary($b), (f = ($a[0] == null ? nil : $a[0])), (e = ($a[1] == null ? nil : $a[1])), $b;
        f = $$($nesting, 'Math').$ldexp(f, $$$($$($nesting, 'Float'), 'MANT_DIG')).$to_i();
        e = $rb_minus(e, $$$($$($nesting, 'Float'), 'MANT_DIG'));
        return $rb_times(f, $$$($$($nesting, 'Float'), 'RADIX')['$**'](e)).$to_r();
      }
    }, $Number_to_r$64.$$arity = 0);
    
    Opal.def(self, '$to_s', $Number_to_s$65 = function $$to_s(base) {
      var $a, self = this;

      
      
      if (base == null) {
        base = 10;
      };
      base = $$($nesting, 'Opal')['$coerce_to!'](base, $$($nesting, 'Integer'), "to_int");
      if ($truthy(($truthy($a = $rb_lt(base, 2)) ? $a : $rb_gt(base, 36)))) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "invalid radix " + (base))};
      return self.toString(base);;
    }, $Number_to_s$65.$$arity = -1);
    
    Opal.def(self, '$truncate', $Number_truncate$66 = function $$truncate(ndigits) {
      var self = this;

      
      
      if (ndigits == null) {
        ndigits = 0;
      };
      
      var f = self.$to_f();

      if (f % 1 === 0 && ndigits >= 0) {
        return f;
      }

      var factor = Math.pow(10, ndigits),
          result = parseInt(f * factor, 10) / factor;

      if (f % 1 === 0) {
        result = Math.round(result);
      }

      return result;
    ;
    }, $Number_truncate$66.$$arity = -1);
    Opal.alias(self, "inspect", "to_s");
    
    ;
    
    Opal.def(self, '$divmod', $Number_divmod$68 = function $$divmod(other) {
      var $a, $iter = $Number_divmod$68.$$p, $yield = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Number_divmod$68.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      if ($truthy(($truthy($a = self['$nan?']()) ? $a : other['$nan?']()))) {
        return self.$raise($$($nesting, 'FloatDomainError'), "NaN")
      } else if ($truthy(self['$infinite?']())) {
        return self.$raise($$($nesting, 'FloatDomainError'), "Infinity")
      } else {
        return $send(self, Opal.find_super_dispatcher(self, 'divmod', $Number_divmod$68, false), $zuper, $iter)
      }
    }, $Number_divmod$68.$$arity = 1);
    
    ;
    
    Opal.def(self, '$zero?', $Number_zero$ques$71 = function() {
      var self = this;

      return self == 0;
    }, $Number_zero$ques$71.$$arity = 0);
    
    Opal.def(self, '$size', $Number_size$72 = function $$size() {
      var self = this;

      return 4
    }, $Number_size$72.$$arity = 0);
    
    Opal.def(self, '$nan?', $Number_nan$ques$73 = function() {
      var self = this;

      return isNaN(self);
    }, $Number_nan$ques$73.$$arity = 0);
    
    Opal.def(self, '$finite?', $Number_finite$ques$74 = function() {
      var self = this;

      return self != Infinity && self != -Infinity && !isNaN(self);
    }, $Number_finite$ques$74.$$arity = 0);
    
    Opal.def(self, '$infinite?', $Number_infinite$ques$75 = function() {
      var self = this;

      
      if (self == Infinity) {
        return +1;
      }
      else if (self == -Infinity) {
        return -1;
      }
      else {
        return nil;
      }
    
    }, $Number_infinite$ques$75.$$arity = 0);
    
    Opal.def(self, '$positive?', $Number_positive$ques$76 = function() {
      var self = this;

      return self != 0 && (self == Infinity || 1 / self > 0);
    }, $Number_positive$ques$76.$$arity = 0);
    return (Opal.def(self, '$negative?', $Number_negative$ques$77 = function() {
      var self = this;

      return self == -Infinity || 1 / self < 0;
    }, $Number_negative$ques$77.$$arity = 0), nil) && 'negative?';
  })($nesting[0], $$($nesting, 'Numeric'), $nesting);
  ;
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Integer');

    var $nesting = [self].concat($parent_nesting);

    
    self.$$is_number_class = true;
    (function(self, $parent_nesting) {
      var $nesting = [self].concat($parent_nesting), $allocate$78, $eq_eq_eq$79, $sqrt$80;

      
      
      Opal.def(self, '$allocate', $allocate$78 = function $$allocate() {
        var self = this;

        return self.$raise($$($nesting, 'TypeError'), "" + "allocator undefined for " + (self.$name()))
      }, $allocate$78.$$arity = 0);
      
      Opal.udef(self, '$' + "new");;
      
      Opal.def(self, '$===', $eq_eq_eq$79 = function(other) {
        var self = this;

        
        if (!other.$$is_number) {
          return false;
        }

        return (other % 1) === 0;
      
      }, $eq_eq_eq$79.$$arity = 1);
      return ( nil) && 'sqrt';
    })(Opal.get_singleton_class(self), $nesting);
    Opal.const_set($nesting[0], 'MAX', Math.pow(2, 30) - 1);
    return Opal.const_set($nesting[0], 'MIN', -Math.pow(2, 30));
  })($nesting[0], $$($nesting, 'Numeric'), $nesting);
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Float');

    var $nesting = [self].concat($parent_nesting);

    
    self.$$is_number_class = true;
    (function(self, $parent_nesting) {
      var $nesting = [self].concat($parent_nesting), $allocate$81, $eq_eq_eq$82;

      
      
      Opal.def(self, '$allocate', $allocate$81 = function $$allocate() {
        var self = this;

        return self.$raise($$($nesting, 'TypeError'), "" + "allocator undefined for " + (self.$name()))
      }, $allocate$81.$$arity = 0);
      
      Opal.udef(self, '$' + "new");;
      return (Opal.def(self, '$===', $eq_eq_eq$82 = function(other) {
        var self = this;

        return !!other.$$is_number;
      }, $eq_eq_eq$82.$$arity = 1), nil) && '===';
    })(Opal.get_singleton_class(self), $nesting);
    Opal.const_set($nesting[0], 'INFINITY', Infinity);
    Opal.const_set($nesting[0], 'MAX', Number.MAX_VALUE);
    Opal.const_set($nesting[0], 'MIN', Number.MIN_VALUE);
    Opal.const_set($nesting[0], 'NAN', NaN);
    Opal.const_set($nesting[0], 'DIG', 15);
    Opal.const_set($nesting[0], 'MANT_DIG', 53);
    Opal.const_set($nesting[0], 'RADIX', 2);
    return ;
  })($nesting[0], $$($nesting, 'Numeric'), $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/range"] = function(Opal) {
  function $rb_le(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs <= rhs : lhs['$<='](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  function $rb_times(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs * rhs : lhs['$*'](rhs);
  }
  function $rb_ge(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs >= rhs : lhs['$>='](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $send = Opal.send;

  
  self.$require("corelib/enumerable");
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Range');

    var $nesting = [self].concat($parent_nesting), $Range_initialize$1, $Range_$eq_eq_eq$2, $Range_cover$ques$3, $Range_each$4, $Range_eql$ques$6, $Range_exclude_end$ques$7, $Range_first$8, $Range_last$9, $Range_max$10, $Range_min$11, $Range_size$12, $Range_step$13, $Range_bsearch$17, $Range_to_s$18, $Range_inspect$19, $Range_marshal_load$20, $Range_hash$21;

    self.$$prototype.begin = self.$$prototype.end = self.$$prototype.excl = nil;
    
    self.$include($$($nesting, 'Enumerable'));
    self.$$prototype.$$is_range = true;
    self.$attr_reader("begin", "end");
    
    Opal.def(self, '$initialize', $Range_initialize$1 = function $$initialize(first, last, exclude) {
      var self = this;

      
      
      if (exclude == null) {
        exclude = false;
      };
      if ($truthy(self.begin)) {
        self.$raise($$($nesting, 'NameError'), "'initialize' called twice")};
      if ($truthy(first['$<=>'](last))) {
      } else {
        self.$raise($$($nesting, 'ArgumentError'), "bad value for range")
      };
      self.begin = first;
      self.end = last;
      return (self.excl = exclude);
    }, $Range_initialize$1.$$arity = -3);
    
    Opal.def(self, '$===', $Range_$eq_eq_eq$2 = function(value) {
      var self = this;

      return self['$include?'](value)
    }, $Range_$eq_eq_eq$2.$$arity = 1);
    
    Opal.def(self, '$cover?', $Range_cover$ques$3 = function(value) {
      var $a, self = this, beg_cmp = nil, end_cmp = nil;

      
      beg_cmp = self.begin['$<=>'](value);
      if ($truthy(($truthy($a = beg_cmp) ? $rb_le(beg_cmp, 0) : $a))) {
      } else {
        return false
      };
      end_cmp = value['$<=>'](self.end);
      if ($truthy(self.excl)) {
        return ($truthy($a = end_cmp) ? $rb_lt(end_cmp, 0) : $a)
      } else {
        return ($truthy($a = end_cmp) ? $rb_le(end_cmp, 0) : $a)
      };
    }, $Range_cover$ques$3.$$arity = 1);
    
    Opal.def(self, '$each', $Range_each$4 = function $$each() {
      var $iter = $Range_each$4.$$p, block = $iter || nil, $$5, $a, self = this, current = nil, last = nil;

      if ($iter) $Range_each$4.$$p = null;
      
      
      if ($iter) $Range_each$4.$$p = null;;
      if ((block !== nil)) {
      } else {
        return $send(self, 'enum_for', ["each"], ($$5 = function(){var self = $$5.$$s == null ? this : $$5.$$s;

        return self.$size()}, $$5.$$s = self, $$5.$$arity = 0, $$5))
      };
      
      var i, limit;

      if (self.begin.$$is_number && self.end.$$is_number) {
        if (self.begin % 1 !== 0 || self.end % 1 !== 0) {
          self.$raise($$($nesting, 'TypeError'), "can't iterate from Float")
        }

        for (i = self.begin, limit = self.end + (function() {if ($truthy(self.excl)) {
        return 0
      } else {
        return 1
      }; return nil; })(); i < limit; i++) {
          block(i);
        }

        return self;
      }

      if (self.begin.$$is_string && self.end.$$is_string) {
        $send(self.begin, 'upto', [self.end, self.excl], block.$to_proc())
        return self;
      }
    ;
      current = self.begin;
      last = self.end;
      if ($truthy(current['$respond_to?']("succ"))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "" + "can't iterate from " + (current.$class()))
      };
      while ($truthy($rb_lt(current['$<=>'](last), 0))) {
        
        Opal.yield1(block, current);
        current = current.$succ();
      };
      if ($truthy(($truthy($a = self.excl['$!']()) ? current['$=='](last) : $a))) {
        Opal.yield1(block, current)};
      return self;
    }, $Range_each$4.$$arity = 0);
    
    Opal.def(self, '$eql?', $Range_eql$ques$6 = function(other) {
      var $a, $b, self = this;

      
      if ($truthy($$($nesting, 'Range')['$==='](other))) {
      } else {
        return false
      };
      return ($truthy($a = ($truthy($b = self.excl['$==='](other['$exclude_end?']())) ? self.begin['$eql?'](other.$begin()) : $b)) ? self.end['$eql?'](other.$end()) : $a);
    }, $Range_eql$ques$6.$$arity = 1);
    Opal.alias(self, "==", "eql?");
    
    Opal.def(self, '$exclude_end?', $Range_exclude_end$ques$7 = function() {
      var self = this;

      return self.excl
    }, $Range_exclude_end$ques$7.$$arity = 0);
    
    Opal.def(self, '$first', $Range_first$8 = function $$first(n) {
      var $iter = $Range_first$8.$$p, $yield = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Range_first$8.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      
      ;
      if ($truthy(n == null)) {
        return self.begin};
      return $send(self, Opal.find_super_dispatcher(self, 'first', $Range_first$8, false), $zuper, $iter);
    }, $Range_first$8.$$arity = -1);
    Opal.alias(self, "include?", "cover?");
    
    Opal.def(self, '$last', $Range_last$9 = function $$last(n) {
      var self = this;

      
      ;
      if ($truthy(n == null)) {
        return self.end};
      return self.$to_a().$last(n);
    }, $Range_last$9.$$arity = -1);
    
    ;
    ;
    
    Opal.def(self, '$min', $Range_min$11 = function $$min() {
      var $a, $iter = $Range_min$11.$$p, $yield = $iter || nil, self = this, $zuper = nil, $zuper_i = nil, $zuper_ii = nil;

      if ($iter) $Range_min$11.$$p = null;
      // Prepare super implicit arguments
      for($zuper_i = 0, $zuper_ii = arguments.length, $zuper = new Array($zuper_ii); $zuper_i < $zuper_ii; $zuper_i++) {
        $zuper[$zuper_i] = arguments[$zuper_i];
      }
      if (($yield !== nil)) {
        return $send(self, Opal.find_super_dispatcher(self, 'min', $Range_min$11, false), $zuper, $iter)
      } else if ($truthy($rb_gt(self.begin, self.end))) {
        return nil
      } else if ($truthy(($truthy($a = self.excl) ? self.begin['$=='](self.end) : $a))) {
        return nil
      } else {
        return self.begin
      }
    }, $Range_min$11.$$arity = 0);
    
    Opal.def(self, '$size', $Range_size$12 = function $$size() {
      var $a, self = this, range_begin = nil, range_end = nil, infinity = nil;

      
      range_begin = self.begin;
      range_end = self.end;
      if ($truthy(self.excl)) {
        range_end = $rb_minus(range_end, 1)};
      if ($truthy(($truthy($a = $$($nesting, 'Numeric')['$==='](range_begin)) ? $$($nesting, 'Numeric')['$==='](range_end) : $a))) {
      } else {
        return nil
      };
      if ($truthy($rb_lt(range_end, range_begin))) {
        return 0};
      infinity = $$$($$($nesting, 'Float'), 'INFINITY');
      if ($truthy([range_begin.$abs(), range_end.$abs()]['$include?'](infinity))) {
        return infinity};
      return (Math.abs(range_end - range_begin) + 1).$to_i();
    }, $Range_size$12.$$arity = 0);
    
    ;
    
    ;
    
    Opal.def(self, '$to_s', $Range_to_s$18 = function $$to_s() {
      var self = this;

      return "" + (self.begin) + ((function() {if ($truthy(self.excl)) {
        return "..."
      } else {
        return ".."
      }; return nil; })()) + (self.end)
    }, $Range_to_s$18.$$arity = 0);
    
    Opal.def(self, '$inspect', $Range_inspect$19 = function $$inspect() {
      var self = this;

      return "" + (self.begin.$inspect()) + ((function() {if ($truthy(self.excl)) {
        return "..."
      } else {
        return ".."
      }; return nil; })()) + (self.end.$inspect())
    }, $Range_inspect$19.$$arity = 0);
    
    ;
    return (Opal.def(self, '$hash', $Range_hash$21 = function $$hash() {
      var self = this;

      return [self.begin, self.end, self.excl].$hash()
    }, $Range_hash$21.$$arity = 0), nil) && 'hash';
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/proc"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $slice = Opal.slice, $klass = Opal.klass, $truthy = Opal.truthy;

  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Proc');

    var $nesting = [self].concat($parent_nesting), $Proc_new$1, $Proc_call$2, $Proc_to_proc$3, $Proc_lambda$ques$4, $Proc_arity$5, $Proc_source_location$6, $Proc_binding$7, $Proc_parameters$8, $Proc_curry$9, $Proc_dup$10;

    
    Opal.defineProperty(self.$$prototype, '$$is_proc', true);
    Opal.defineProperty(self.$$prototype, '$$is_lambda', false);
    Opal.defs(self, '$new', $Proc_new$1 = function() {
      var $iter = $Proc_new$1.$$p, block = $iter || nil, self = this;

      if ($iter) $Proc_new$1.$$p = null;
      
      
      if ($iter) $Proc_new$1.$$p = null;;
      if ($truthy(block)) {
      } else {
        self.$raise($$($nesting, 'ArgumentError'), "tried to create a Proc object without a block")
      };
      return block;
    }, $Proc_new$1.$$arity = 0);
    
    Opal.def(self, '$call', $Proc_call$2 = function $$call($a) {
      var $iter = $Proc_call$2.$$p, block = $iter || nil, $post_args, args, self = this;

      if ($iter) $Proc_call$2.$$p = null;
      
      
      if ($iter) $Proc_call$2.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      
      if (block !== nil) {
        self.$$p = block;
      }

      var result, $brk = self.$$brk;

      if ($brk) {
        try {
          if (self.$$is_lambda) {
            result = self.apply(null, args);
          }
          else {
            result = Opal.yieldX(self, args);
          }
        } catch (err) {
          if (err === $brk) {
            return $brk.$v
          }
          else {
            throw err
          }
        }
      }
      else {
        if (self.$$is_lambda) {
          result = self.apply(null, args);
        }
        else {
          result = Opal.yieldX(self, args);
        }
      }

      return result;
    ;
    }, $Proc_call$2.$$arity = -1);
    Opal.alias(self, "[]", "call");
    Opal.alias(self, "===", "call");
    Opal.alias(self, "yield", "call");
    
    Opal.def(self, '$to_proc', $Proc_to_proc$3 = function $$to_proc() {
      var self = this;

      return self
    }, $Proc_to_proc$3.$$arity = 0);
    
    Opal.def(self, '$lambda?', $Proc_lambda$ques$4 = function() {
      var self = this;

      return !!self.$$is_lambda;
    }, $Proc_lambda$ques$4.$$arity = 0);
    
    Opal.def(self, '$arity', $Proc_arity$5 = function $$arity() {
      var self = this;

      
      if (self.$$is_curried) {
        return -1;
      } else {
        return self.$$arity;
      }
    
    }, $Proc_arity$5.$$arity = 0);
    
    Opal.def(self, '$source_location', $Proc_source_location$6 = function $$source_location() {
      var self = this;

      
      if (self.$$is_curried) { return nil; };
      return nil;
    }, $Proc_source_location$6.$$arity = 0);
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$dup', $Proc_dup$10 = function $$dup() {
      var self = this;

      
      var original_proc = self.$$original_proc || self,
          proc = function () {
            return original_proc.apply(this, arguments);
          };

      for (var prop in self) {
        if (self.hasOwnProperty(prop)) {
          proc[prop] = self[prop];
        }
      }

      return proc;
    
    }, $Proc_dup$10.$$arity = 0);
    return Opal.alias(self, "clone", "dup");
  })($nesting[0], Function, $nesting)
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/method"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy;

  
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Method');

    var $nesting = [self].concat($parent_nesting), $Method_initialize$1, $Method_arity$2, $Method_parameters$3, $Method_source_location$4, $Method_comments$5, $Method_call$6, $Method_unbind$7, $Method_to_proc$8, $Method_inspect$9;

    self.$$prototype.method = self.$$prototype.receiver = self.$$prototype.owner = self.$$prototype.name = nil;
    
    self.$attr_reader("owner", "receiver", "name");
    
    Opal.def(self, '$initialize', $Method_initialize$1 = function $$initialize(receiver, owner, method, name) {
      var self = this;

      
      self.receiver = receiver;
      self.owner = owner;
      self.name = name;
      return (self.method = method);
    }, $Method_initialize$1.$$arity = 4);
    
    Opal.def(self, '$arity', $Method_arity$2 = function $$arity() {
      var self = this;

      return self.method.$arity()
    }, $Method_arity$2.$$arity = 0);
    
    ;
    
    Opal.def(self, '$source_location', $Method_source_location$4 = function $$source_location() {
      var $a, self = this;

      return ($truthy($a = self.method.$$source_location) ? $a : ["(eval)", 0])
    }, $Method_source_location$4.$$arity = 0);
    
    ;
    
    Opal.def(self, '$call', $Method_call$6 = function $$call($a) {
      var $iter = $Method_call$6.$$p, block = $iter || nil, $post_args, args, self = this;

      if ($iter) $Method_call$6.$$p = null;
      
      
      if ($iter) $Method_call$6.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      
      self.method.$$p = block;

      return self.method.apply(self.receiver, args);
    ;
    }, $Method_call$6.$$arity = -1);
    Opal.alias(self, "[]", "call");
    
    ;
    
    Opal.def(self, '$to_proc', $Method_to_proc$8 = function $$to_proc() {
      var self = this;

      
      var proc = self.$call.bind(self);
      proc.$$unbound = self.method;
      proc.$$is_lambda = true;
      proc.$$arity = self.method.$$arity;
      proc.$$parameters = self.method.$$parameters;
      return proc;
    
    }, $Method_to_proc$8.$$arity = 0);
    return (Opal.def(self, '$inspect', $Method_inspect$9 = function $$inspect() {
      var self = this;

      return "" + "#<" + (self.$class()) + ": " + (self.receiver.$class()) + "#" + (self.name) + " (defined in " + (self.owner) + " in " + (self.$source_location().$join(":")) + ")>"
    }, $Method_inspect$9.$$arity = 0), nil) && 'inspect';
  })($nesting[0], null, $nesting);
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'UnboundMethod');

    var $nesting = [self].concat($parent_nesting), $UnboundMethod_initialize$10, $UnboundMethod_arity$11, $UnboundMethod_parameters$12, $UnboundMethod_source_location$13, $UnboundMethod_comments$14, $UnboundMethod_bind$15, $UnboundMethod_inspect$16;

    self.$$prototype.method = self.$$prototype.owner = self.$$prototype.name = self.$$prototype.source = nil;
    
    self.$attr_reader("source", "owner", "name");
    
    Opal.def(self, '$initialize', $UnboundMethod_initialize$10 = function $$initialize(source, owner, method, name) {
      var self = this;

      
      self.source = source;
      self.owner = owner;
      self.method = method;
      return (self.name = name);
    }, $UnboundMethod_initialize$10.$$arity = 4);
    
    Opal.def(self, '$arity', $UnboundMethod_arity$11 = function $$arity() {
      var self = this;

      return self.method.$arity()
    }, $UnboundMethod_arity$11.$$arity = 0);
    
    ;
    
    Opal.def(self, '$source_location', $UnboundMethod_source_location$13 = function $$source_location() {
      var $a, self = this;

      return ($truthy($a = self.method.$$source_location) ? $a : ["(eval)", 0])
    }, $UnboundMethod_source_location$13.$$arity = 0);
    
    ;
    
    Opal.def(self, '$bind', $UnboundMethod_bind$15 = function $$bind(object) {
      var self = this;

      
      if (self.owner.$$is_module || Opal.is_a(object, self.owner)) {
        return $$($nesting, 'Method').$new(object, self.owner, self.method, self.name);
      }
      else {
        self.$raise($$($nesting, 'TypeError'), "" + "can't bind singleton method to a different class (expected " + (object) + ".kind_of?(" + (self.owner) + " to be true)");
      }
    
    }, $UnboundMethod_bind$15.$$arity = 1);
    return (Opal.def(self, '$inspect', $UnboundMethod_inspect$16 = function $$inspect() {
      var self = this;

      return "" + "#<" + (self.$class()) + ": " + (self.source) + "#" + (self.name) + " (defined in " + (self.owner) + " in " + (self.$source_location().$join(":")) + ")>"
    }, $UnboundMethod_inspect$16.$$arity = 0), nil) && 'inspect';
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/variables"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $gvars = Opal.gvars, $hash2 = Opal.hash2;

  
  $gvars['&'] = $gvars['~'] = $gvars['`'] = $gvars["'"] = nil;
  $gvars.LOADED_FEATURES = ($gvars["\""] = Opal.loaded_features);
  $gvars.LOAD_PATH = ($gvars[":"] = []);
  $gvars["/"] = "\n";
  $gvars[","] = nil;
  ;
  ;
  ;
  $gvars.VERBOSE = false;
  $gvars.DEBUG = false;
  return ($gvars.SAFE = 0);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/io"] = function(Opal) {
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $module = Opal.module, $send = Opal.send, $gvars = Opal.gvars, $truthy = Opal.truthy, $writer = nil;

  
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'IO');

    var $nesting = [self].concat($parent_nesting), $IO_tty$ques$1, $IO_closed$ques$2, $IO_write$3, $IO_flush$4;

    self.$$prototype.tty = self.$$prototype.closed = nil;
    
    ;
    ;
    ;
    
    ;
    
    ;
    self.$attr_accessor("write_proc");
    
    Opal.def(self, '$write', $IO_write$3 = function $$write(string) {
      var self = this;

      
      self.write_proc(string);
      return string.$size();
    }, $IO_write$3.$$arity = 1);
    self.$attr_accessor("sync", "tty");
    
    ;
    (function($base, $parent_nesting) {
      var self = $module($base, 'Writable');

      var $nesting = [self].concat($parent_nesting), $Writable_$lt$lt$5, $Writable_print$6, $Writable_puts$8;

      
      
      Opal.def(self, '$<<', $Writable_$lt$lt$5 = function(string) {
        var self = this;

        
        self.$write(string);
        return self;
      }, $Writable_$lt$lt$5.$$arity = 1);
      
      ;
      
      Opal.def(self, '$puts', $Writable_puts$8 = function $$puts($a) {
        var $post_args, args, $$9, self = this, newline = nil;
        if ($gvars["/"] == null) $gvars["/"] = nil;

        
        
        $post_args = Opal.slice.call(arguments, 0, arguments.length);
        
        args = $post_args;;
        newline = $gvars["/"];
        if ($truthy(args['$empty?']())) {
          self.$write($gvars["/"])
        } else {
          self.$write($send(args, 'map', [], ($$9 = function(arg){var self = $$9.$$s == null ? this : $$9.$$s;

          
            
            if (arg == null) {
              arg = nil;
            };
            return self.$String(arg).$chomp();}, $$9.$$s = self, $$9.$$arity = 1, $$9)).$concat([nil]).$join(newline))
        };
        return nil;
      }, $Writable_puts$8.$$arity = -1);
    })($nesting[0], $nesting);
    return ;
  })($nesting[0], null, $nesting);
  Opal.const_set($nesting[0], 'STDERR', ($gvars.stderr = $$($nesting, 'IO').$new()));
  ;
  Opal.const_set($nesting[0], 'STDOUT', ($gvars.stdout = $$($nesting, 'IO').$new()));
  var console = Opal.global.console;
  
  $writer = [typeof(process) === 'object' && typeof(process.stdout) === 'object' ? function(s){process.stdout.write(s)} : function(s){console.log(s)}];
  $send($$($nesting, 'STDOUT'), 'write_proc=', Opal.to_a($writer));
  $writer[$rb_minus($writer["length"], 1)];;
  
  $writer = [typeof(process) === 'object' && typeof(process.stderr) === 'object' ? function(s){process.stderr.write(s)} : function(s){console.warn(s)}];
  $send($$($nesting, 'STDERR'), 'write_proc=', Opal.to_a($writer));
  $writer[$rb_minus($writer["length"], 1)];;
  $$($nesting, 'STDOUT').$extend($$$($$($nesting, 'IO'), 'Writable'));
  return $$($nesting, 'STDERR').$extend($$$($$($nesting, 'IO'), 'Writable'));
};

/* Generated by Opal 1.0.0 */
Opal.modules["opal/regexp_anchors"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $module = Opal.module;

  return (function($base, $parent_nesting) {
    var self = $module($base, 'Opal');

    var $nesting = [self].concat($parent_nesting);

    
    Opal.const_set($nesting[0], 'REGEXP_START', (function() {if ($$($nesting, 'RUBY_ENGINE')['$==']("opal")) {
      return "^"
    } else {
      return nil
    }; return nil; })());
    Opal.const_set($nesting[0], 'REGEXP_END', (function() {if ($$($nesting, 'RUBY_ENGINE')['$==']("opal")) {
      return "$"
    } else {
      return nil
    }; return nil; })());
    ;
    ;
    ;
    Opal.const_set($nesting[0], 'FORBIDDEN_CONST_NAME_CHARS', "\\u0001-\\u0020\\u0021-\\u002F\\u003B-\\u003F\\u0040\\u005B-\\u005E\\u0060\\u007B-\\u007F");
    Opal.const_set($nesting[0], 'CONST_NAME_REGEXP', $$($nesting, 'Regexp').$new("" + ($$($nesting, 'REGEXP_START')) + "(::)?[A-Z][^" + ($$($nesting, 'FORBIDDEN_CONST_NAME_CHARS')) + "]*" + ($$($nesting, 'REGEXP_END'))));
  })($nesting[0], $nesting)
};

/* Generated by Opal 1.0.0 */
Opal.modules["opal/mini"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$;

  
  self.$require("opal/base");
  self.$require("corelib/nil");
  self.$require("corelib/boolean");
  self.$require("corelib/string");
  self.$require("corelib/comparable");
  self.$require("corelib/enumerable");
  self.$require("corelib/enumerator");
  self.$require("corelib/array");
  self.$require("corelib/hash");
  self.$require("corelib/number");
  self.$require("corelib/range");
  self.$require("corelib/proc");
  self.$require("corelib/method");
  self.$require("corelib/regexp");
  self.$require("corelib/variables");
  self.$require("corelib/io");
  return self.$require("opal/regexp_anchors");
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/kernel/format"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $module = Opal.module, $truthy = Opal.truthy, $gvars = Opal.gvars;

  return (function($base, $parent_nesting) {
    var self = $module($base, 'Kernel');

    var $nesting = [self].concat($parent_nesting), $Kernel_format$1;

    
    
    Opal.def(self, '$format', $Kernel_format$1 = function $$format(format_string, $a) {
      var $post_args, args, $b, self = this, ary = nil;
      if ($gvars.DEBUG == null) $gvars.DEBUG = nil;

      
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      args = $post_args;;
      if ($truthy((($b = args.$length()['$=='](1)) ? args['$[]'](0)['$respond_to?']("to_ary") : args.$length()['$=='](1)))) {
        
        ary = $$($nesting, 'Opal')['$coerce_to?'](args['$[]'](0), $$($nesting, 'Array'), "to_ary");
        if ($truthy(ary['$nil?']())) {
        } else {
          args = ary.$to_a()
        };};
      
      var result = '',
          //used for slicing:
          begin_slice = 0,
          end_slice,
          //used for iterating over the format string:
          i,
          len = format_string.length,
          //used for processing field values:
          arg,
          str,
          //used for processing %g and %G fields:
          exponent,
          //used for keeping track of width and precision:
          width,
          precision,
          //used for holding temporary values:
          tmp_num,
          //used for processing %{} and %<> fileds:
          hash_parameter_key,
          closing_brace_char,
          //used for processing %b, %B, %o, %x, and %X fields:
          base_number,
          base_prefix,
          base_neg_zero_regex,
          base_neg_zero_digit,
          //used for processing arguments:
          next_arg,
          seq_arg_num = 1,
          pos_arg_num = 0,
          //used for keeping track of flags:
          flags,
          FNONE  = 0,
          FSHARP = 1,
          FMINUS = 2,
          FPLUS  = 4,
          FZERO  = 8,
          FSPACE = 16,
          FWIDTH = 32,
          FPREC  = 64,
          FPREC0 = 128;

      function CHECK_FOR_FLAGS() {
        if (flags&FWIDTH) { self.$raise($$($nesting, 'ArgumentError'), "flag after width") }
        if (flags&FPREC0) { self.$raise($$($nesting, 'ArgumentError'), "flag after precision") }
      }

      function CHECK_FOR_WIDTH() {
        if (flags&FWIDTH) { self.$raise($$($nesting, 'ArgumentError'), "width given twice") }
        if (flags&FPREC0) { self.$raise($$($nesting, 'ArgumentError'), "width after precision") }
      }

      function GET_NTH_ARG(num) {
        if (num >= args.length) { self.$raise($$($nesting, 'ArgumentError'), "too few arguments") }
        return args[num];
      }

      function GET_NEXT_ARG() {
        switch (pos_arg_num) {
        case -1: self.$raise($$($nesting, 'ArgumentError'), "" + "unnumbered(" + (seq_arg_num) + ") mixed with numbered")
        case -2: self.$raise($$($nesting, 'ArgumentError'), "" + "unnumbered(" + (seq_arg_num) + ") mixed with named")
        }
        pos_arg_num = seq_arg_num++;
        return GET_NTH_ARG(pos_arg_num - 1);
      }

      function GET_POS_ARG(num) {
        if (pos_arg_num > 0) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "numbered(" + (num) + ") after unnumbered(" + (pos_arg_num) + ")")
        }
        if (pos_arg_num === -2) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "numbered(" + (num) + ") after named")
        }
        if (num < 1) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "invalid index - " + (num) + "$")
        }
        pos_arg_num = -1;
        return GET_NTH_ARG(num - 1);
      }

      function GET_ARG() {
        return (next_arg === undefined ? GET_NEXT_ARG() : next_arg);
      }

      function READ_NUM(label) {
        var num, str = '';
        for (;; i++) {
          if (i === len) {
            self.$raise($$($nesting, 'ArgumentError'), "malformed format string - %*[0-9]")
          }
          if (format_string.charCodeAt(i) < 48 || format_string.charCodeAt(i) > 57) {
            i--;
            num = parseInt(str, 10) || 0;
            if (num > 2147483647) {
              self.$raise($$($nesting, 'ArgumentError'), "" + (label) + " too big")
            }
            return num;
          }
          str += format_string.charAt(i);
        }
      }

      function READ_NUM_AFTER_ASTER(label) {
        var arg, num = READ_NUM(label);
        if (format_string.charAt(i + 1) === '$') {
          i++;
          arg = GET_POS_ARG(num);
        } else {
          arg = GET_NEXT_ARG();
        }
        return (arg).$to_int();
      }

      for (i = format_string.indexOf('%'); i !== -1; i = format_string.indexOf('%', i)) {
        str = undefined;

        flags = FNONE;
        width = -1;
        precision = -1;
        next_arg = undefined;

        end_slice = i;

        i++;

        switch (format_string.charAt(i)) {
        case '%':
          begin_slice = i;
        case '':
        case '\n':
        case '\0':
          i++;
          continue;
        }

        format_sequence: for (; i < len; i++) {
          switch (format_string.charAt(i)) {

          case ' ':
            CHECK_FOR_FLAGS();
            flags |= FSPACE;
            continue format_sequence;

          case '#':
            CHECK_FOR_FLAGS();
            flags |= FSHARP;
            continue format_sequence;

          case '+':
            CHECK_FOR_FLAGS();
            flags |= FPLUS;
            continue format_sequence;

          case '-':
            CHECK_FOR_FLAGS();
            flags |= FMINUS;
            continue format_sequence;

          case '0':
            CHECK_FOR_FLAGS();
            flags |= FZERO;
            continue format_sequence;

          case '1':
          case '2':
          case '3':
          case '4':
          case '5':
          case '6':
          case '7':
          case '8':
          case '9':
            tmp_num = READ_NUM('width');
            if (format_string.charAt(i + 1) === '$') {
              if (i + 2 === len) {
                str = '%';
                i++;
                break format_sequence;
              }
              if (next_arg !== undefined) {
                self.$raise($$($nesting, 'ArgumentError'), "" + "value given twice - %" + (tmp_num) + "$")
              }
              next_arg = GET_POS_ARG(tmp_num);
              i++;
            } else {
              CHECK_FOR_WIDTH();
              flags |= FWIDTH;
              width = tmp_num;
            }
            continue format_sequence;

          case '<':
          case '\{':
            closing_brace_char = (format_string.charAt(i) === '<' ? '>' : '\}');
            hash_parameter_key = '';

            i++;

            for (;; i++) {
              if (i === len) {
                self.$raise($$($nesting, 'ArgumentError'), "malformed name - unmatched parenthesis")
              }
              if (format_string.charAt(i) === closing_brace_char) {

                if (pos_arg_num > 0) {
                  self.$raise($$($nesting, 'ArgumentError'), "" + "named " + (hash_parameter_key) + " after unnumbered(" + (pos_arg_num) + ")")
                }
                if (pos_arg_num === -1) {
                  self.$raise($$($nesting, 'ArgumentError'), "" + "named " + (hash_parameter_key) + " after numbered")
                }
                pos_arg_num = -2;

                if (args[0] === undefined || !args[0].$$is_hash) {
                  self.$raise($$($nesting, 'ArgumentError'), "one hash required")
                }

                next_arg = (args[0]).$fetch(hash_parameter_key);

                if (closing_brace_char === '>') {
                  continue format_sequence;
                } else {
                  str = next_arg.toString();
                  if (precision !== -1) { str = str.slice(0, precision); }
                  if (flags&FMINUS) {
                    while (str.length < width) { str = str + ' '; }
                  } else {
                    while (str.length < width) { str = ' ' + str; }
                  }
                  break format_sequence;
                }
              }
              hash_parameter_key += format_string.charAt(i);
            }

          case '*':
            i++;
            CHECK_FOR_WIDTH();
            flags |= FWIDTH;
            width = READ_NUM_AFTER_ASTER('width');
            if (width < 0) {
              flags |= FMINUS;
              width = -width;
            }
            continue format_sequence;

          case '.':
            if (flags&FPREC0) {
              self.$raise($$($nesting, 'ArgumentError'), "precision given twice")
            }
            flags |= FPREC|FPREC0;
            precision = 0;
            i++;
            if (format_string.charAt(i) === '*') {
              i++;
              precision = READ_NUM_AFTER_ASTER('precision');
              if (precision < 0) {
                flags &= ~FPREC;
              }
              continue format_sequence;
            }
            precision = READ_NUM('precision');
            continue format_sequence;

          case 'd':
          case 'i':
          case 'u':
            arg = self.$Integer(GET_ARG());
            if (arg >= 0) {
              str = arg.toString();
              while (str.length < precision) { str = '0' + str; }
              if (flags&FMINUS) {
                if (flags&FPLUS || flags&FSPACE) { str = (flags&FPLUS ? '+' : ' ') + str; }
                while (str.length < width) { str = str + ' '; }
              } else {
                if (flags&FZERO && precision === -1) {
                  while (str.length < width - ((flags&FPLUS || flags&FSPACE) ? 1 : 0)) { str = '0' + str; }
                  if (flags&FPLUS || flags&FSPACE) { str = (flags&FPLUS ? '+' : ' ') + str; }
                } else {
                  if (flags&FPLUS || flags&FSPACE) { str = (flags&FPLUS ? '+' : ' ') + str; }
                  while (str.length < width) { str = ' ' + str; }
                }
              }
            } else {
              str = (-arg).toString();
              while (str.length < precision) { str = '0' + str; }
              if (flags&FMINUS) {
                str = '-' + str;
                while (str.length < width) { str = str + ' '; }
              } else {
                if (flags&FZERO && precision === -1) {
                  while (str.length < width - 1) { str = '0' + str; }
                  str = '-' + str;
                } else {
                  str = '-' + str;
                  while (str.length < width) { str = ' ' + str; }
                }
              }
            }
            break format_sequence;

          case 'b':
          case 'B':
          case 'o':
          case 'x':
          case 'X':
            switch (format_string.charAt(i)) {
            case 'b':
            case 'B':
              base_number = 2;
              base_prefix = '0b';
              base_neg_zero_regex = /^1+/;
              base_neg_zero_digit = '1';
              break;
            case 'o':
              base_number = 8;
              base_prefix = '0';
              base_neg_zero_regex = /^3?7+/;
              base_neg_zero_digit = '7';
              break;
            case 'x':
            case 'X':
              base_number = 16;
              base_prefix = '0x';
              base_neg_zero_regex = /^f+/;
              base_neg_zero_digit = 'f';
              break;
            }
            arg = self.$Integer(GET_ARG());
            if (arg >= 0) {
              str = arg.toString(base_number);
              while (str.length < precision) { str = '0' + str; }
              if (flags&FMINUS) {
                if (flags&FPLUS || flags&FSPACE) { str = (flags&FPLUS ? '+' : ' ') + str; }
                if (flags&FSHARP && arg !== 0) { str = base_prefix + str; }
                while (str.length < width) { str = str + ' '; }
              } else {
                if (flags&FZERO && precision === -1) {
                  while (str.length < width - ((flags&FPLUS || flags&FSPACE) ? 1 : 0) - ((flags&FSHARP && arg !== 0) ? base_prefix.length : 0)) { str = '0' + str; }
                  if (flags&FSHARP && arg !== 0) { str = base_prefix + str; }
                  if (flags&FPLUS || flags&FSPACE) { str = (flags&FPLUS ? '+' : ' ') + str; }
                } else {
                  if (flags&FSHARP && arg !== 0) { str = base_prefix + str; }
                  if (flags&FPLUS || flags&FSPACE) { str = (flags&FPLUS ? '+' : ' ') + str; }
                  while (str.length < width) { str = ' ' + str; }
                }
              }
            } else {
              if (flags&FPLUS || flags&FSPACE) {
                str = (-arg).toString(base_number);
                while (str.length < precision) { str = '0' + str; }
                if (flags&FMINUS) {
                  if (flags&FSHARP) { str = base_prefix + str; }
                  str = '-' + str;
                  while (str.length < width) { str = str + ' '; }
                } else {
                  if (flags&FZERO && precision === -1) {
                    while (str.length < width - 1 - (flags&FSHARP ? 2 : 0)) { str = '0' + str; }
                    if (flags&FSHARP) { str = base_prefix + str; }
                    str = '-' + str;
                  } else {
                    if (flags&FSHARP) { str = base_prefix + str; }
                    str = '-' + str;
                    while (str.length < width) { str = ' ' + str; }
                  }
                }
              } else {
                str = (arg >>> 0).toString(base_number).replace(base_neg_zero_regex, base_neg_zero_digit);
                while (str.length < precision - 2) { str = base_neg_zero_digit + str; }
                if (flags&FMINUS) {
                  str = '..' + str;
                  if (flags&FSHARP) { str = base_prefix + str; }
                  while (str.length < width) { str = str + ' '; }
                } else {
                  if (flags&FZERO && precision === -1) {
                    while (str.length < width - 2 - (flags&FSHARP ? base_prefix.length : 0)) { str = base_neg_zero_digit + str; }
                    str = '..' + str;
                    if (flags&FSHARP) { str = base_prefix + str; }
                  } else {
                    str = '..' + str;
                    if (flags&FSHARP) { str = base_prefix + str; }
                    while (str.length < width) { str = ' ' + str; }
                  }
                }
              }
            }
            if (format_string.charAt(i) === format_string.charAt(i).toUpperCase()) {
              str = str.toUpperCase();
            }
            break format_sequence;

          case 'f':
          case 'e':
          case 'E':
          case 'g':
          case 'G':
            arg = self.$Float(GET_ARG());
            if (arg >= 0 || isNaN(arg)) {
              if (arg === Infinity) {
                str = 'Inf';
              } else {
                switch (format_string.charAt(i)) {
                case 'f':
                  str = arg.toFixed(precision === -1 ? 6 : precision);
                  break;
                case 'e':
                case 'E':
                  str = arg.toExponential(precision === -1 ? 6 : precision);
                  break;
                case 'g':
                case 'G':
                  str = arg.toExponential();
                  exponent = parseInt(str.split('e')[1], 10);
                  if (!(exponent < -4 || exponent >= (precision === -1 ? 6 : precision))) {
                    str = arg.toPrecision(precision === -1 ? (flags&FSHARP ? 6 : undefined) : precision);
                  }
                  break;
                }
              }
              if (flags&FMINUS) {
                if (flags&FPLUS || flags&FSPACE) { str = (flags&FPLUS ? '+' : ' ') + str; }
                while (str.length < width) { str = str + ' '; }
              } else {
                if (flags&FZERO && arg !== Infinity && !isNaN(arg)) {
                  while (str.length < width - ((flags&FPLUS || flags&FSPACE) ? 1 : 0)) { str = '0' + str; }
                  if (flags&FPLUS || flags&FSPACE) { str = (flags&FPLUS ? '+' : ' ') + str; }
                } else {
                  if (flags&FPLUS || flags&FSPACE) { str = (flags&FPLUS ? '+' : ' ') + str; }
                  while (str.length < width) { str = ' ' + str; }
                }
              }
            } else {
              if (arg === -Infinity) {
                str = 'Inf';
              } else {
                switch (format_string.charAt(i)) {
                case 'f':
                  str = (-arg).toFixed(precision === -1 ? 6 : precision);
                  break;
                case 'e':
                case 'E':
                  str = (-arg).toExponential(precision === -1 ? 6 : precision);
                  break;
                case 'g':
                case 'G':
                  str = (-arg).toExponential();
                  exponent = parseInt(str.split('e')[1], 10);
                  if (!(exponent < -4 || exponent >= (precision === -1 ? 6 : precision))) {
                    str = (-arg).toPrecision(precision === -1 ? (flags&FSHARP ? 6 : undefined) : precision);
                  }
                  break;
                }
              }
              if (flags&FMINUS) {
                str = '-' + str;
                while (str.length < width) { str = str + ' '; }
              } else {
                if (flags&FZERO && arg !== -Infinity) {
                  while (str.length < width - 1) { str = '0' + str; }
                  str = '-' + str;
                } else {
                  str = '-' + str;
                  while (str.length < width) { str = ' ' + str; }
                }
              }
            }
            if (format_string.charAt(i) === format_string.charAt(i).toUpperCase() && arg !== Infinity && arg !== -Infinity && !isNaN(arg)) {
              str = str.toUpperCase();
            }
            str = str.replace(/([eE][-+]?)([0-9])$/, '$10$2');
            break format_sequence;

          case 'a':
          case 'A':
            // Not implemented because there are no specs for this field type.
            self.$raise($$($nesting, 'NotImplementedError'), "`A` and `a` format field types are not implemented in Opal yet")

          case 'c':
            arg = GET_ARG();
            if ((arg)['$respond_to?']("to_ary")) { arg = (arg).$to_ary()[0]; }
            if ((arg)['$respond_to?']("to_str")) {
              str = (arg).$to_str();
            } else {
              str = String.fromCharCode($$($nesting, 'Opal').$coerce_to(arg, $$($nesting, 'Integer'), "to_int"));
            }
            if (str.length !== 1) {
              self.$raise($$($nesting, 'ArgumentError'), "%c requires a character")
            }
            if (flags&FMINUS) {
              while (str.length < width) { str = str + ' '; }
            } else {
              while (str.length < width) { str = ' ' + str; }
            }
            break format_sequence;

          case 'p':
            str = (GET_ARG()).$inspect();
            if (precision !== -1) { str = str.slice(0, precision); }
            if (flags&FMINUS) {
              while (str.length < width) { str = str + ' '; }
            } else {
              while (str.length < width) { str = ' ' + str; }
            }
            break format_sequence;

          case 's':
            str = (GET_ARG()).$to_s();
            if (precision !== -1) { str = str.slice(0, precision); }
            if (flags&FMINUS) {
              while (str.length < width) { str = str + ' '; }
            } else {
              while (str.length < width) { str = ' ' + str; }
            }
            break format_sequence;

          default:
            self.$raise($$($nesting, 'ArgumentError'), "" + "malformed format string - %" + (format_string.charAt(i)))
          }
        }

        if (str === undefined) {
          self.$raise($$($nesting, 'ArgumentError'), "malformed format string - %")
        }

        result += format_string.slice(begin_slice, end_slice) + str;
        begin_slice = i + 1;
      }

      if ($gvars.DEBUG && pos_arg_num >= 0 && seq_arg_num < args.length) {
        self.$raise($$($nesting, 'ArgumentError'), "too many arguments for format string")
      }

      return result + format_string.slice(begin_slice);
    ;
    }, $Kernel_format$1.$$arity = -2);
    ;
  })($nesting[0], $nesting)
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/string/encoding"] = function(Opal) {
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  var $$12, $$15, $$18, $$21, $$24, self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $hash2 = Opal.hash2, $truthy = Opal.truthy, $send = Opal.send;

  
  self.$require("corelib/string");
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Encoding');

    var $nesting = [self].concat($parent_nesting), $Encoding_register$1, $Encoding_find$3, $Encoding_initialize$4, $Encoding_ascii_compatible$ques$5, $Encoding_dummy$ques$6, $Encoding_to_s$7, $Encoding_inspect$8, $Encoding_each_byte$9, $Encoding_getbyte$10, $Encoding_bytesize$11;

    self.$$prototype.ascii = self.$$prototype.dummy = self.$$prototype.name = nil;
    
    Opal.defs(self, '$register', $Encoding_register$1 = function $$register(name, options) {
      var $iter = $Encoding_register$1.$$p, block = $iter || nil, $a, $$2, self = this, names = nil, ascii = nil, dummy = nil, encoding = nil, register = nil;

      if ($iter) $Encoding_register$1.$$p = null;
      
      
      if ($iter) $Encoding_register$1.$$p = null;;
      
      if (options == null) {
        options = $hash2([], {});
      };
      names = $rb_plus([name], ($truthy($a = options['$[]']("aliases")) ? $a : []));
      ascii = ($truthy($a = options['$[]']("ascii")) ? $a : false);
      dummy = ($truthy($a = options['$[]']("dummy")) ? $a : false);
      encoding = self.$new(name, names, ascii, dummy);
      $send(encoding, 'instance_eval', [], block.$to_proc());
      register = Opal.encodings;
      return $send(names, 'each', [], ($$2 = function(encoding_name){var self = $$2.$$s == null ? this : $$2.$$s;

      
        
        if (encoding_name == null) {
          encoding_name = nil;
        };
        self.$const_set(encoding_name.$sub("-", "_"), encoding);
        return register[encoding_name] = encoding;}, $$2.$$s = self, $$2.$$arity = 1, $$2));
    }, $Encoding_register$1.$$arity = -2);
    Opal.defs(self, '$find', $Encoding_find$3 = function $$find(name) {
      var $a, self = this, register = nil, encoding = nil;

      
      if (name['$==']("default_external")) {
        return self.$default_external()};
      register = Opal.encodings;
      encoding = ($truthy($a = register[name]) ? $a : register[name.$upcase()]);
      if ($truthy(encoding)) {
      } else {
        self.$raise($$($nesting, 'ArgumentError'), "" + "unknown encoding name - " + (name))
      };
      return encoding;
    }, $Encoding_find$3.$$arity = 1);
    self.$singleton_class().$attr_accessor("default_external");
    self.$attr_reader("name", "names");
    
    Opal.def(self, '$initialize', $Encoding_initialize$4 = function $$initialize(name, names, ascii, dummy) {
      var self = this;

      
      self.name = name;
      self.names = names;
      self.ascii = ascii;
      return (self.dummy = dummy);
    }, $Encoding_initialize$4.$$arity = 4);
    
    ;
    
    ;
    
    Opal.def(self, '$to_s', $Encoding_to_s$7 = function $$to_s() {
      var self = this;

      return self.name
    }, $Encoding_to_s$7.$$arity = 0);
    
    Opal.def(self, '$inspect', $Encoding_inspect$8 = function $$inspect() {
      var self = this;

      return "" + "#<Encoding:" + (self.name) + ((function() {if ($truthy(self.dummy)) {
        return " (dummy)"
      } else {
        return nil
      }; return nil; })()) + ">"
    }, $Encoding_inspect$8.$$arity = 0);
    
    Opal.def(self, '$each_byte', $Encoding_each_byte$9 = function $$each_byte($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return self.$raise($$($nesting, 'NotImplementedError'));
    }, $Encoding_each_byte$9.$$arity = -1);
    
    Opal.def(self, '$getbyte', $Encoding_getbyte$10 = function $$getbyte($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return self.$raise($$($nesting, 'NotImplementedError'));
    }, $Encoding_getbyte$10.$$arity = -1);
    
    Opal.def(self, '$bytesize', $Encoding_bytesize$11 = function $$bytesize($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return self.$raise($$($nesting, 'NotImplementedError'));
    }, $Encoding_bytesize$11.$$arity = -1);
    ;
    return ;
  })($nesting[0], null, $nesting);
  $send($$($nesting, 'Encoding'), 'register', ["UTF-8", $hash2(["aliases", "ascii"], {"aliases": ["CP65001"], "ascii": true})], ($$12 = function(){var self = $$12.$$s == null ? this : $$12.$$s, $each_byte$13, $bytesize$14;

  
    
    Opal.def(self, '$each_byte', $each_byte$13 = function $$each_byte(string) {
      var $iter = $each_byte$13.$$p, block = $iter || nil, self = this;

      if ($iter) $each_byte$13.$$p = null;
      
      
      if ($iter) $each_byte$13.$$p = null;;
      
      for (var i = 0, length = string.length; i < length; i++) {
        var code = string.charCodeAt(i);

        if (code <= 0x7f) {
          Opal.yield1(block, code);
        }
        else {
          var encoded = encodeURIComponent(string.charAt(i)).substr(1).split('%');

          for (var j = 0, encoded_length = encoded.length; j < encoded_length; j++) {
            Opal.yield1(block, parseInt(encoded[j], 16));
          }
        }
      }
    ;
    }, $each_byte$13.$$arity = 1);
    return (Opal.def(self, '$bytesize', $bytesize$14 = function $$bytesize(string) {
      var self = this;

      return string.$bytes().$length()
    }, $bytesize$14.$$arity = 1), nil) && 'bytesize';}, $$12.$$s = self, $$12.$$arity = 0, $$12));
  $send($$($nesting, 'Encoding'), 'register', ["UTF-16LE"], ($$15 = function(){var self = $$15.$$s == null ? this : $$15.$$s, $each_byte$16, $bytesize$17;

  
    
    Opal.def(self, '$each_byte', $each_byte$16 = function $$each_byte(string) {
      var $iter = $each_byte$16.$$p, block = $iter || nil, self = this;

      if ($iter) $each_byte$16.$$p = null;
      
      
      if ($iter) $each_byte$16.$$p = null;;
      
      for (var i = 0, length = string.length; i < length; i++) {
        var code = string.charCodeAt(i);

        Opal.yield1(block, code & 0xff);
        Opal.yield1(block, code >> 8);
      }
    ;
    }, $each_byte$16.$$arity = 1);
    return (Opal.def(self, '$bytesize', $bytesize$17 = function $$bytesize(string) {
      var self = this;

      return string.$bytes().$length()
    }, $bytesize$17.$$arity = 1), nil) && 'bytesize';}, $$15.$$s = self, $$15.$$arity = 0, $$15));
  $send($$($nesting, 'Encoding'), 'register', ["UTF-16BE"], ($$18 = function(){var self = $$18.$$s == null ? this : $$18.$$s, $each_byte$19, $bytesize$20;

  
    
    Opal.def(self, '$each_byte', $each_byte$19 = function $$each_byte(string) {
      var $iter = $each_byte$19.$$p, block = $iter || nil, self = this;

      if ($iter) $each_byte$19.$$p = null;
      
      
      if ($iter) $each_byte$19.$$p = null;;
      
      for (var i = 0, length = string.length; i < length; i++) {
        var code = string.charCodeAt(i);

        Opal.yield1(block, code >> 8);
        Opal.yield1(block, code & 0xff);
      }
    ;
    }, $each_byte$19.$$arity = 1);
    return (Opal.def(self, '$bytesize', $bytesize$20 = function $$bytesize(string) {
      var self = this;

      return string.$bytes().$length()
    }, $bytesize$20.$$arity = 1), nil) && 'bytesize';}, $$18.$$s = self, $$18.$$arity = 0, $$18));
  $send($$($nesting, 'Encoding'), 'register', ["UTF-32LE"], ($$21 = function(){var self = $$21.$$s == null ? this : $$21.$$s, $each_byte$22, $bytesize$23;

  
    
    Opal.def(self, '$each_byte', $each_byte$22 = function $$each_byte(string) {
      var $iter = $each_byte$22.$$p, block = $iter || nil, self = this;

      if ($iter) $each_byte$22.$$p = null;
      
      
      if ($iter) $each_byte$22.$$p = null;;
      
      for (var i = 0, length = string.length; i < length; i++) {
        var code = string.charCodeAt(i);

        Opal.yield1(block, code & 0xff);
        Opal.yield1(block, code >> 8);
      }
    ;
    }, $each_byte$22.$$arity = 1);
    return (Opal.def(self, '$bytesize', $bytesize$23 = function $$bytesize(string) {
      var self = this;

      return string.$bytes().$length()
    }, $bytesize$23.$$arity = 1), nil) && 'bytesize';}, $$21.$$s = self, $$21.$$arity = 0, $$21));
  $send($$($nesting, 'Encoding'), 'register', ["ASCII-8BIT", $hash2(["aliases", "ascii", "dummy"], {"aliases": ["BINARY", "US-ASCII", "ASCII"], "ascii": true, "dummy": true})], ($$24 = function(){var self = $$24.$$s == null ? this : $$24.$$s, $each_byte$25, $bytesize$26;

  
    
    Opal.def(self, '$each_byte', $each_byte$25 = function $$each_byte(string) {
      var $iter = $each_byte$25.$$p, block = $iter || nil, self = this;

      if ($iter) $each_byte$25.$$p = null;
      
      
      if ($iter) $each_byte$25.$$p = null;;
      
      for (var i = 0, length = string.length; i < length; i++) {
        var code = string.charCodeAt(i);
        Opal.yield1(block, code & 0xff);
        Opal.yield1(block, code >> 8);
      }
    ;
    }, $each_byte$25.$$arity = 1);
    return (Opal.def(self, '$bytesize', $bytesize$26 = function $$bytesize(string) {
      var self = this;

      return string.$bytes().$length()
    }, $bytesize$26.$$arity = 1), nil) && 'bytesize';}, $$24.$$s = self, $$24.$$arity = 0, $$24));
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'String');

    var $nesting = [self].concat($parent_nesting), $String_bytes$27, $String_bytesize$28, $String_each_byte$29, $String_each_codepoint$30, $String_codepoints$31, $String_encode$32, $String_force_encoding$33, $String_getbyte$34, $String_valid_encoding$ques$35;

    self.$$prototype.encoding = nil;
    
    self.$attr_reader("encoding");
    Opal.defineProperty(String.prototype, 'encoding', $$$($$($nesting, 'Encoding'), 'UTF_16LE'));
    
    Opal.def(self, '$bytes', $String_bytes$27 = function $$bytes() {
      var self = this;

      return self.$each_byte().$to_a()
    }, $String_bytes$27.$$arity = 0);
    
    Opal.def(self, '$bytesize', $String_bytesize$28 = function $$bytesize() {
      var self = this;

      return self.encoding.$bytesize(self)
    }, $String_bytesize$28.$$arity = 0);
    
    Opal.def(self, '$each_byte', $String_each_byte$29 = function $$each_byte() {
      var $iter = $String_each_byte$29.$$p, block = $iter || nil, self = this;

      if ($iter) $String_each_byte$29.$$p = null;
      
      
      if ($iter) $String_each_byte$29.$$p = null;;
      if ((block !== nil)) {
      } else {
        return self.$enum_for("each_byte")
      };
      $send(self.encoding, 'each_byte', [self], block.$to_proc());
      return self;
    }, $String_each_byte$29.$$arity = 0);
    
    ;
    
    ;
    
    Opal.def(self, '$encode', $String_encode$32 = function $$encode(encoding) {
      var self = this;

      return self.$dup().$force_encoding(encoding)
    }, $String_encode$32.$$arity = 1);
    
    Opal.def(self, '$force_encoding', $String_force_encoding$33 = function $$force_encoding(encoding) {
      var self = this;

      
      if (encoding === self.encoding) { return self; }

      encoding = $$($nesting, 'Opal')['$coerce_to!'](encoding, $$($nesting, 'String'), "to_s");
      encoding = $$($nesting, 'Encoding').$find(encoding);

      if (encoding === self.encoding) { return self; }

      Opal.set_encoding(self, encoding);

      return self;
    
    }, $String_force_encoding$33.$$arity = 1);
    
    Opal.def(self, '$getbyte', $String_getbyte$34 = function $$getbyte(idx) {
      var self = this;

      return self.encoding.$getbyte(self, idx)
    }, $String_getbyte$34.$$arity = 1);
    return ( nil) && 'valid_encoding?';
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/math"] = function(Opal) {
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $module = Opal.module, $truthy = Opal.truthy;

  return (function($base, $parent_nesting) {
    var self = $module($base, 'Math');

    var $nesting = [self].concat($parent_nesting), $Math_checked$1, $Math_float$excl$2, $Math_integer$excl$3, $Math_acos$4, $Math_acosh$5, $Math_asin$6, $Math_asinh$7, $Math_atan$8, $Math_atan2$9, $Math_atanh$10, $Math_cbrt$11, $Math_cos$12, $Math_cosh$13, $Math_erf$14, $Math_erfc$15, $Math_exp$16, $Math_frexp$17, $Math_gamma$18, $Math_hypot$19, $Math_ldexp$20, $Math_lgamma$21, $Math_log$22, $Math_log10$23, $Math_log2$24, $Math_sin$25, $Math_sinh$26, $Math_sqrt$27, $Math_tan$28, $Math_tanh$29;

    
    Opal.const_set($nesting[0], 'E', Math.E);
    Opal.const_set($nesting[0], 'PI', Math.PI);
    Opal.const_set($nesting[0], 'DomainError', $$($nesting, 'Class').$new($$($nesting, 'StandardError')));
    Opal.defs(self, '$checked', $Math_checked$1 = function $$checked(method, $a) {
      var $post_args, args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      args = $post_args;;
      
      if (isNaN(args[0]) || (args.length == 2 && isNaN(args[1]))) {
        return NaN;
      }

      var result = Math[method].apply(null, args);

      if (isNaN(result)) {
        self.$raise($$($nesting, 'DomainError'), "" + "Numerical argument is out of domain - \"" + (method) + "\"");
      }

      return result;
    ;
    }, $Math_checked$1.$$arity = -2);
    Opal.defs(self, '$float!', $Math_float$excl$2 = function(value) {
      var self = this;

      try {
        return self.$Float(value)
      } catch ($err) {
        if (Opal.rescue($err, [$$($nesting, 'ArgumentError')])) {
          try {
            return self.$raise($$($nesting, 'Opal').$type_error(value, $$($nesting, 'Float')))
          } finally { Opal.pop_exception() }
        } else { throw $err; }
      }
    }, $Math_float$excl$2.$$arity = 1);
    Opal.defs(self, '$integer!', $Math_integer$excl$3 = function(value) {
      var self = this;

      try {
        return self.$Integer(value)
      } catch ($err) {
        if (Opal.rescue($err, [$$($nesting, 'ArgumentError')])) {
          try {
            return self.$raise($$($nesting, 'Opal').$type_error(value, $$($nesting, 'Integer')))
          } finally { Opal.pop_exception() }
        } else { throw $err; }
      }
    }, $Math_integer$excl$3.$$arity = 1);
    self.$module_function();
    
    ;
    if ($truthy((typeof(Math.acosh) !== "undefined"))) {
    } else {
      
      Math.acosh = function(x) {
        return Math.log(x + Math.sqrt(x * x - 1));
      }
    
    };
    
    ;
    
    ;
    if ($truthy((typeof(Math.asinh) !== "undefined"))) {
    } else {
      
      Math.asinh = function(x) {
        return Math.log(x + Math.sqrt(x * x + 1))
      }
    
    };
    
    ;
    
    ;
    
    Opal.def(self, '$atan2', $Math_atan2$9 = function $$atan2(y, x) {
      var self = this;

      return $$($nesting, 'Math').$checked("atan2", $$($nesting, 'Math')['$float!'](y), $$($nesting, 'Math')['$float!'](x))
    }, $Math_atan2$9.$$arity = 2);
    if ($truthy((typeof(Math.atanh) !== "undefined"))) {
    } else {
      
      Math.atanh = function(x) {
        return 0.5 * Math.log((1 + x) / (1 - x));
      }
    
    };
    
    ;
    if ($truthy((typeof(Math.cbrt) !== "undefined"))) {
    } else {
      
      Math.cbrt = function(x) {
        if (x == 0) {
          return 0;
        }

        if (x < 0) {
          return -Math.cbrt(-x);
        }

        var r  = x,
            ex = 0;

        while (r < 0.125) {
          r *= 8;
          ex--;
        }

        while (r > 1.0) {
          r *= 0.125;
          ex++;
        }

        r = (-0.46946116 * r + 1.072302) * r + 0.3812513;

        while (ex < 0) {
          r *= 0.5;
          ex++;
        }

        while (ex > 0) {
          r *= 2;
          ex--;
        }

        r = (2.0 / 3.0) * r + (1.0 / 3.0) * x / (r * r);
        r = (2.0 / 3.0) * r + (1.0 / 3.0) * x / (r * r);
        r = (2.0 / 3.0) * r + (1.0 / 3.0) * x / (r * r);
        r = (2.0 / 3.0) * r + (1.0 / 3.0) * x / (r * r);

        return r;
      }
    
    };
    
    ;
    
    Opal.def(self, '$cos', $Math_cos$12 = function $$cos(x) {
      var self = this;

      return $$($nesting, 'Math').$checked("cos", $$($nesting, 'Math')['$float!'](x))
    }, $Math_cos$12.$$arity = 1);
    if ($truthy((typeof(Math.cosh) !== "undefined"))) {
    } else {
      
      Math.cosh = function(x) {
        return (Math.exp(x) + Math.exp(-x)) / 2;
      }
    
    };
    
    ;
    if ($truthy((typeof(Math.erf) !== "undefined"))) {
    } else {
      
      Opal.defineProperty(Math, 'erf', function(x) {
        var A1 =  0.254829592,
            A2 = -0.284496736,
            A3 =  1.421413741,
            A4 = -1.453152027,
            A5 =  1.061405429,
            P  =  0.3275911;

        var sign = 1;

        if (x < 0) {
            sign = -1;
        }

        x = Math.abs(x);

        var t = 1.0 / (1.0 + P * x);
        var y = 1.0 - (((((A5 * t + A4) * t) + A3) * t + A2) * t + A1) * t * Math.exp(-x * x);

        return sign * y;
      });
    
    };
    
    ;
    if ($truthy((typeof(Math.erfc) !== "undefined"))) {
    } else {
      
      Opal.defineProperty(Math, 'erfc', function(x) {
        var z = Math.abs(x),
            t = 1.0 / (0.5 * z + 1.0);

        var A1 = t * 0.17087277 + -0.82215223,
            A2 = t * A1 + 1.48851587,
            A3 = t * A2 + -1.13520398,
            A4 = t * A3 + 0.27886807,
            A5 = t * A4 + -0.18628806,
            A6 = t * A5 + 0.09678418,
            A7 = t * A6 + 0.37409196,
            A8 = t * A7 + 1.00002368,
            A9 = t * A8,
            A10 = -z * z - 1.26551223 + A9;

        var a = t * Math.exp(A10);

        if (x < 0.0) {
          return 2.0 - a;
        }
        else {
          return a;
        }
      });
    
    };
    
    ;
    
    Opal.def(self, '$exp', $Math_exp$16 = function $$exp(x) {
      var self = this;

      return $$($nesting, 'Math').$checked("exp", $$($nesting, 'Math')['$float!'](x))
    }, $Math_exp$16.$$arity = 1);
    
    Opal.def(self, '$frexp', $Math_frexp$17 = function $$frexp(x) {
      var self = this;

      
      x = $$($nesting, 'Math')['$float!'](x);
      
      if (isNaN(x)) {
        return [NaN, 0];
      }

      var ex   = Math.floor(Math.log(Math.abs(x)) / Math.log(2)) + 1,
          frac = x / Math.pow(2, ex);

      return [frac, ex];
    ;
    }, $Math_frexp$17.$$arity = 1);
    
    Opal.def(self, '$gamma', $Math_gamma$18 = function $$gamma(n) {
      var self = this;

      
      n = $$($nesting, 'Math')['$float!'](n);
      
      var i, t, x, value, result, twoN, threeN, fourN, fiveN;

      var G = 4.7421875;

      var P = [
         0.99999999999999709182,
         57.156235665862923517,
        -59.597960355475491248,
         14.136097974741747174,
        -0.49191381609762019978,
         0.33994649984811888699e-4,
         0.46523628927048575665e-4,
        -0.98374475304879564677e-4,
         0.15808870322491248884e-3,
        -0.21026444172410488319e-3,
         0.21743961811521264320e-3,
        -0.16431810653676389022e-3,
         0.84418223983852743293e-4,
        -0.26190838401581408670e-4,
         0.36899182659531622704e-5
      ];


      if (isNaN(n)) {
        return NaN;
      }

      if (n === 0 && 1 / n < 0) {
        return -Infinity;
      }

      if (n === -1 || n === -Infinity) {
        self.$raise($$($nesting, 'DomainError'), "Numerical argument is out of domain - \"gamma\"");
      }

      if ($$($nesting, 'Integer')['$==='](n)) {
        if (n <= 0) {
          return isFinite(n) ? Infinity : NaN;
        }

        if (n > 171) {
          return Infinity;
        }

        value  = n - 2;
        result = n - 1;

        while (value > 1) {
          result *= value;
          value--;
        }

        if (result == 0) {
          result = 1;
        }

        return result;
      }

      if (n < 0.5) {
        return Math.PI / (Math.sin(Math.PI * n) * $$($nesting, 'Math').$gamma($rb_minus(1, n)));
      }

      if (n >= 171.35) {
        return Infinity;
      }

      if (n > 85.0) {
        twoN   = n * n;
        threeN = twoN * n;
        fourN  = threeN * n;
        fiveN  = fourN * n;

        return Math.sqrt(2 * Math.PI / n) * Math.pow((n / Math.E), n) *
          (1 + 1 / (12 * n) + 1 / (288 * twoN) - 139 / (51840 * threeN) -
          571 / (2488320 * fourN) + 163879 / (209018880 * fiveN) +
          5246819 / (75246796800 * fiveN * n));
      }

      n -= 1;
      x  = P[0];

      for (i = 1; i < P.length; ++i) {
        x += P[i] / (n + i);
      }

      t = n + G + 0.5;

      return Math.sqrt(2 * Math.PI) * Math.pow(t, n + 0.5) * Math.exp(-t) * x;
    ;
    }, $Math_gamma$18.$$arity = 1);
    if ($truthy((typeof(Math.hypot) !== "undefined"))) {
    } else {
      
      Math.hypot = function(x, y) {
        return Math.sqrt(x * x + y * y)
      }
    
    };
    
    Opal.def(self, '$hypot', $Math_hypot$19 = function $$hypot(x, y) {
      var self = this;

      return $$($nesting, 'Math').$checked("hypot", $$($nesting, 'Math')['$float!'](x), $$($nesting, 'Math')['$float!'](y))
    }, $Math_hypot$19.$$arity = 2);
    
    Opal.def(self, '$ldexp', $Math_ldexp$20 = function $$ldexp(mantissa, exponent) {
      var self = this;

      
      mantissa = $$($nesting, 'Math')['$float!'](mantissa);
      exponent = $$($nesting, 'Math')['$integer!'](exponent);
      
      if (isNaN(exponent)) {
        self.$raise($$($nesting, 'RangeError'), "float NaN out of range of integer");
      }

      return mantissa * Math.pow(2, exponent);
    ;
    }, $Math_ldexp$20.$$arity = 2);
    
    ;
    
    Opal.def(self, '$log', $Math_log$22 = function $$log(x, base) {
      var self = this;

      
      ;
      if ($truthy($$($nesting, 'String')['$==='](x))) {
        self.$raise($$($nesting, 'Opal').$type_error(x, $$($nesting, 'Float')))};
      if ($truthy(base == null)) {
        return $$($nesting, 'Math').$checked("log", $$($nesting, 'Math')['$float!'](x))
      } else {
        
        if ($truthy($$($nesting, 'String')['$==='](base))) {
          self.$raise($$($nesting, 'Opal').$type_error(base, $$($nesting, 'Float')))};
        return $rb_divide($$($nesting, 'Math').$checked("log", $$($nesting, 'Math')['$float!'](x)), $$($nesting, 'Math').$checked("log", $$($nesting, 'Math')['$float!'](base)));
      };
    }, $Math_log$22.$$arity = -2);
    if ($truthy((typeof(Math.log10) !== "undefined"))) {
    } else {
      
      Math.log10 = function(x) {
        return Math.log(x) / Math.LN10;
      }
    
    };
    
    ;
    if ($truthy((typeof(Math.log2) !== "undefined"))) {
    } else {
      
      Math.log2 = function(x) {
        return Math.log(x) / Math.LN2;
      }
    
    };
    
    ;
    
    Opal.def(self, '$sin', $Math_sin$25 = function $$sin(x) {
      var self = this;

      return $$($nesting, 'Math').$checked("sin", $$($nesting, 'Math')['$float!'](x))
    }, $Math_sin$25.$$arity = 1);
    if ($truthy((typeof(Math.sinh) !== "undefined"))) {
    } else {
      
      Math.sinh = function(x) {
        return (Math.exp(x) - Math.exp(-x)) / 2;
      }
    
    };
    
    ;
    
    ;
    
    ;
    if ($truthy((typeof(Math.tanh) !== "undefined"))) {
    } else {
      
      Math.tanh = function(x) {
        if (x == Infinity) {
          return 1;
        }
        else if (x == -Infinity) {
          return -1;
        }
        else {
          return (Math.exp(x) - Math.exp(-x)) / (Math.exp(x) + Math.exp(-x));
        }
      }
    
    };
    
    ;
  })($nesting[0], $nesting)
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/complex"] = function(Opal) {
  function $rb_times(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs * rhs : lhs['$*'](rhs);
  }
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $module = Opal.module;

  
  self.$require("corelib/numeric");
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Complex');

    var $nesting = [self].concat($parent_nesting), $Complex_rect$1, $Complex_polar$2, $Complex_initialize$3, $Complex_coerce$4, $Complex_$eq_eq$5, $Complex_$minus$$6, $Complex_$plus$7, $Complex_$minus$8, $Complex_$$9, $Complex_$slash$10, $Complex_$$$11, $Complex_abs$12, $Complex_abs2$13, $Complex_angle$14, $Complex_conj$15, $Complex_denominator$16, $Complex_eql$ques$17, $Complex_fdiv$18, $Complex_finite$ques$19, $Complex_hash$20, $Complex_infinite$ques$21, $Complex_inspect$22, $Complex_numerator$23, $Complex_polar$24, $Complex_rationalize$25, $Complex_real$ques$26, $Complex_rect$27, $Complex_to_f$28, $Complex_to_i$29, $Complex_to_r$30, $Complex_to_s$31;

    self.$$prototype.real = self.$$prototype.imag = nil;
    
    ;
    (function(self, $parent_nesting) {
      var $nesting = [self].concat($parent_nesting);

      return 
    })(Opal.get_singleton_class(self), $nesting);
    Opal.defs(self, '$polar', $Complex_polar$2 = function $$polar(r, theta) {
      var $a, $b, $c, self = this;

      
      
      if (theta == null) {
        theta = 0;
      };
      if ($truthy(($truthy($a = ($truthy($b = ($truthy($c = $$($nesting, 'Numeric')['$==='](r)) ? r['$real?']() : $c)) ? $$($nesting, 'Numeric')['$==='](theta) : $b)) ? theta['$real?']() : $a))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "not a real")
      };
      return self.$new($rb_times(r, $$($nesting, 'Math').$cos(theta)), $rb_times(r, $$($nesting, 'Math').$sin(theta)));
    }, $Complex_polar$2.$$arity = -2);
    self.$attr_reader("real", "imag");
    
    Opal.def(self, '$initialize', $Complex_initialize$3 = function $$initialize(real, imag) {
      var self = this;

      
      
      if (imag == null) {
        imag = 0;
      };
      self.real = real;
      return (self.imag = imag);
    }, $Complex_initialize$3.$$arity = -2);
    
    Opal.def(self, '$coerce', $Complex_coerce$4 = function $$coerce(other) {
      var $a, self = this;

      if ($truthy($$($nesting, 'Complex')['$==='](other))) {
        return [other, self]
      } else if ($truthy(($truthy($a = $$($nesting, 'Numeric')['$==='](other)) ? other['$real?']() : $a))) {
        return [$$($nesting, 'Complex').$new(other, 0), self]
      } else {
        return self.$raise($$($nesting, 'TypeError'), "" + (other.$class()) + " can't be coerced into Complex")
      }
    }, $Complex_coerce$4.$$arity = 1);
    
    Opal.def(self, '$==', $Complex_$eq_eq$5 = function(other) {
      var $a, self = this;

      if ($truthy($$($nesting, 'Complex')['$==='](other))) {
        return (($a = self.real['$=='](other.$real())) ? self.imag['$=='](other.$imag()) : self.real['$=='](other.$real()))
      } else if ($truthy(($truthy($a = $$($nesting, 'Numeric')['$==='](other)) ? other['$real?']() : $a))) {
        return (($a = self.real['$=='](other)) ? self.imag['$=='](0) : self.real['$=='](other))
      } else {
        return other['$=='](self)
      }
    }, $Complex_$eq_eq$5.$$arity = 1);
    
    Opal.def(self, '$-@', $Complex_$minus$$6 = function() {
      var self = this;

      return self.$Complex(self.real['$-@'](), self.imag['$-@']())
    }, $Complex_$minus$$6.$$arity = 0);
    
    Opal.def(self, '$+', $Complex_$plus$7 = function(other) {
      var $a, self = this;

      if ($truthy($$($nesting, 'Complex')['$==='](other))) {
        return self.$Complex($rb_plus(self.real, other.$real()), $rb_plus(self.imag, other.$imag()))
      } else if ($truthy(($truthy($a = $$($nesting, 'Numeric')['$==='](other)) ? other['$real?']() : $a))) {
        return self.$Complex($rb_plus(self.real, other), self.imag)
      } else {
        return self.$__coerced__("+", other)
      }
    }, $Complex_$plus$7.$$arity = 1);
    
    Opal.def(self, '$-', $Complex_$minus$8 = function(other) {
      var $a, self = this;

      if ($truthy($$($nesting, 'Complex')['$==='](other))) {
        return self.$Complex($rb_minus(self.real, other.$real()), $rb_minus(self.imag, other.$imag()))
      } else if ($truthy(($truthy($a = $$($nesting, 'Numeric')['$==='](other)) ? other['$real?']() : $a))) {
        return self.$Complex($rb_minus(self.real, other), self.imag)
      } else {
        return self.$__coerced__("-", other)
      }
    }, $Complex_$minus$8.$$arity = 1);
    
    Opal.def(self, '$*', $Complex_$$9 = function(other) {
      var $a, self = this;

      if ($truthy($$($nesting, 'Complex')['$==='](other))) {
        return self.$Complex($rb_minus($rb_times(self.real, other.$real()), $rb_times(self.imag, other.$imag())), $rb_plus($rb_times(self.real, other.$imag()), $rb_times(self.imag, other.$real())))
      } else if ($truthy(($truthy($a = $$($nesting, 'Numeric')['$==='](other)) ? other['$real?']() : $a))) {
        return self.$Complex($rb_times(self.real, other), $rb_times(self.imag, other))
      } else {
        return self.$__coerced__("*", other)
      }
    }, $Complex_$$9.$$arity = 1);
    
    Opal.def(self, '$/', $Complex_$slash$10 = function(other) {
      var $a, $b, $c, $d, self = this;

      if ($truthy($$($nesting, 'Complex')['$==='](other))) {
        if ($truthy(($truthy($a = ($truthy($b = ($truthy($c = ($truthy($d = $$($nesting, 'Number')['$==='](self.real)) ? self.real['$nan?']() : $d)) ? $c : ($truthy($d = $$($nesting, 'Number')['$==='](self.imag)) ? self.imag['$nan?']() : $d))) ? $b : ($truthy($c = $$($nesting, 'Number')['$==='](other.$real())) ? other.$real()['$nan?']() : $c))) ? $a : ($truthy($b = $$($nesting, 'Number')['$==='](other.$imag())) ? other.$imag()['$nan?']() : $b)))) {
          return $$($nesting, 'Complex').$new($$$($$($nesting, 'Float'), 'NAN'), $$$($$($nesting, 'Float'), 'NAN'))
        } else {
          return $rb_divide($rb_times(self, other.$conj()), other.$abs2())
        }
      } else if ($truthy(($truthy($a = $$($nesting, 'Numeric')['$==='](other)) ? other['$real?']() : $a))) {
        return self.$Complex(self.real.$quo(other), self.imag.$quo(other))
      } else {
        return self.$__coerced__("/", other)
      }
    }, $Complex_$slash$10.$$arity = 1);
    
    Opal.def(self, '$**', $Complex_$$$11 = function(other) {
      var $a, $b, $c, $d, self = this, r = nil, theta = nil, ore = nil, oim = nil, nr = nil, ntheta = nil, x = nil, z = nil, n = nil, div = nil, mod = nil;

      
      if (other['$=='](0)) {
        return $$($nesting, 'Complex').$new(1, 0)};
      if ($truthy($$($nesting, 'Complex')['$==='](other))) {
        
        $b = self.$polar(), $a = Opal.to_ary($b), (r = ($a[0] == null ? nil : $a[0])), (theta = ($a[1] == null ? nil : $a[1])), $b;
        ore = other.$real();
        oim = other.$imag();
        nr = $$($nesting, 'Math').$exp($rb_minus($rb_times(ore, $$($nesting, 'Math').$log(r)), $rb_times(oim, theta)));
        ntheta = $rb_plus($rb_times(theta, ore), $rb_times(oim, $$($nesting, 'Math').$log(r)));
        return $$($nesting, 'Complex').$polar(nr, ntheta);
      } else if ($truthy($$($nesting, 'Integer')['$==='](other))) {
        if ($truthy($rb_gt(other, 0))) {
          
          x = self;
          z = x;
          n = $rb_minus(other, 1);
          while ($truthy(n['$!='](0))) {
            
            $c = n.$divmod(2), $b = Opal.to_ary($c), (div = ($b[0] == null ? nil : $b[0])), (mod = ($b[1] == null ? nil : $b[1])), $c;
            while (mod['$=='](0)) {
              
              x = self.$Complex($rb_minus($rb_times(x.$real(), x.$real()), $rb_times(x.$imag(), x.$imag())), $rb_times($rb_times(2, x.$real()), x.$imag()));
              n = div;
              $d = n.$divmod(2), $c = Opal.to_ary($d), (div = ($c[0] == null ? nil : $c[0])), (mod = ($c[1] == null ? nil : $c[1])), $d;
            };
            z = $rb_times(z, x);
            n = $rb_minus(n, 1);
          };
          return z;
        } else {
          return $rb_divide($$($nesting, 'Rational').$new(1, 1), self)['$**'](other['$-@']())
        }
      } else if ($truthy(($truthy($a = $$($nesting, 'Float')['$==='](other)) ? $a : $$($nesting, 'Rational')['$==='](other)))) {
        
        $b = self.$polar(), $a = Opal.to_ary($b), (r = ($a[0] == null ? nil : $a[0])), (theta = ($a[1] == null ? nil : $a[1])), $b;
        return $$($nesting, 'Complex').$polar(r['$**'](other), $rb_times(theta, other));
      } else {
        return self.$__coerced__("**", other)
      };
    }, $Complex_$$$11.$$arity = 1);
    
    Opal.def(self, '$abs', $Complex_abs$12 = function $$abs() {
      var self = this;

      return $$($nesting, 'Math').$hypot(self.real, self.imag)
    }, $Complex_abs$12.$$arity = 0);
    
    Opal.def(self, '$abs2', $Complex_abs2$13 = function $$abs2() {
      var self = this;

      return $rb_plus($rb_times(self.real, self.real), $rb_times(self.imag, self.imag))
    }, $Complex_abs2$13.$$arity = 0);
    
    Opal.def(self, '$angle', $Complex_angle$14 = function $$angle() {
      var self = this;

      return $$($nesting, 'Math').$atan2(self.imag, self.real)
    }, $Complex_angle$14.$$arity = 0);
    Opal.alias(self, "arg", "angle");
    
    Opal.def(self, '$conj', $Complex_conj$15 = function $$conj() {
      var self = this;

      return self.$Complex(self.real, self.imag['$-@']())
    }, $Complex_conj$15.$$arity = 0);
    ;
    
    Opal.def(self, '$denominator', $Complex_denominator$16 = function $$denominator() {
      var self = this;

      return self.real.$denominator().$lcm(self.imag.$denominator())
    }, $Complex_denominator$16.$$arity = 0);
    ;
    
    Opal.def(self, '$eql?', $Complex_eql$ques$17 = function(other) {
      var $a, $b, self = this;

      return ($truthy($a = ($truthy($b = $$($nesting, 'Complex')['$==='](other)) ? self.real.$class()['$=='](self.imag.$class()) : $b)) ? self['$=='](other) : $a)
    }, $Complex_eql$ques$17.$$arity = 1);
    
    ;
    
    Opal.def(self, '$finite?', $Complex_finite$ques$19 = function() {
      var $a, self = this;

      return ($truthy($a = self.real['$finite?']()) ? self.imag['$finite?']() : $a)
    }, $Complex_finite$ques$19.$$arity = 0);
    
    Opal.def(self, '$hash', $Complex_hash$20 = function $$hash() {
      var self = this;

      return "" + "Complex:" + (self.real) + ":" + (self.imag)
    }, $Complex_hash$20.$$arity = 0);
    ;
    
    Opal.def(self, '$infinite?', $Complex_infinite$ques$21 = function() {
      var $a, self = this;

      return ($truthy($a = self.real['$infinite?']()) ? $a : self.imag['$infinite?']())
    }, $Complex_infinite$ques$21.$$arity = 0);
    
    Opal.def(self, '$inspect', $Complex_inspect$22 = function $$inspect() {
      var self = this;

      return "" + "(" + (self) + ")"
    }, $Complex_inspect$22.$$arity = 0);
    ;
    
    Opal.udef(self, '$' + "negative?");;
    
    Opal.def(self, '$numerator', $Complex_numerator$23 = function $$numerator() {
      var self = this, d = nil;

      
      d = self.$denominator();
      return self.$Complex($rb_times(self.real.$numerator(), $rb_divide(d, self.real.$denominator())), $rb_times(self.imag.$numerator(), $rb_divide(d, self.imag.$denominator())));
    }, $Complex_numerator$23.$$arity = 0);
    ;
    
    Opal.def(self, '$polar', $Complex_polar$24 = function $$polar() {
      var self = this;

      return [self.$abs(), self.$arg()]
    }, $Complex_polar$24.$$arity = 0);
    
    Opal.udef(self, '$' + "positive?");;
    Opal.alias(self, "quo", "/");
    
    Opal.def(self, '$rationalize', $Complex_rationalize$25 = function $$rationalize(eps) {
      var self = this;

      
      ;
      
      if (arguments.length > 1) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "wrong number of arguments (" + (arguments.length) + " for 0..1)");
      }
    ;
      if ($truthy(self.imag['$!='](0))) {
        self.$raise($$($nesting, 'RangeError'), "" + "can't' convert " + (self) + " into Rational")};
      return self.$real().$rationalize(eps);
    }, $Complex_rationalize$25.$$arity = -1);
    
    Opal.def(self, '$real?', $Complex_real$ques$26 = function() {
      var self = this;

      return false
    }, $Complex_real$ques$26.$$arity = 0);
    
    ;
    ;
    
    Opal.def(self, '$to_f', $Complex_to_f$28 = function $$to_f() {
      var self = this;

      
      if (self.imag['$=='](0)) {
      } else {
        self.$raise($$($nesting, 'RangeError'), "" + "can't convert " + (self) + " into Float")
      };
      return self.real.$to_f();
    }, $Complex_to_f$28.$$arity = 0);
    
    Opal.def(self, '$to_i', $Complex_to_i$29 = function $$to_i() {
      var self = this;

      
      if (self.imag['$=='](0)) {
      } else {
        self.$raise($$($nesting, 'RangeError'), "" + "can't convert " + (self) + " into Integer")
      };
      return self.real.$to_i();
    }, $Complex_to_i$29.$$arity = 0);
    
    Opal.def(self, '$to_r', $Complex_to_r$30 = function $$to_r() {
      var self = this;

      
      if (self.imag['$=='](0)) {
      } else {
        self.$raise($$($nesting, 'RangeError'), "" + "can't convert " + (self) + " into Rational")
      };
      return self.real.$to_r();
    }, $Complex_to_r$30.$$arity = 0);
    
    Opal.def(self, '$to_s', $Complex_to_s$31 = function $$to_s() {
      var $a, $b, $c, self = this, result = nil;

      
      result = self.real.$inspect();
      result = $rb_plus(result, (function() {if ($truthy(($truthy($a = ($truthy($b = ($truthy($c = $$($nesting, 'Number')['$==='](self.imag)) ? self.imag['$nan?']() : $c)) ? $b : self.imag['$positive?']())) ? $a : self.imag['$zero?']()))) {
        return "+"
      } else {
        return "-"
      }; return nil; })());
      result = $rb_plus(result, self.imag.$abs().$inspect());
      if ($truthy(($truthy($a = $$($nesting, 'Number')['$==='](self.imag)) ? ($truthy($b = self.imag['$nan?']()) ? $b : self.imag['$infinite?']()) : $a))) {
        result = $rb_plus(result, "*")};
      return $rb_plus(result, "i");
    }, $Complex_to_s$31.$$arity = 0);
    return Opal.const_set($nesting[0], 'I', self.$new(0, 1));
  })($nesting[0], $$($nesting, 'Numeric'), $nesting);
  (function($base, $parent_nesting) {
    var self = $module($base, 'Kernel');

    var $nesting = [self].concat($parent_nesting), $Kernel_Complex$32;

    
    Opal.def(self, '$Complex', $Kernel_Complex$32 = function $$Complex(real, imag) {
      var self = this;

      
      
      if (imag == null) {
        imag = nil;
      };
      if ($truthy(imag)) {
        return $$($nesting, 'Complex').$new(real, imag)
      } else {
        return $$($nesting, 'Complex').$new(real, 0)
      };
    }, $Kernel_Complex$32.$$arity = -2)
  })($nesting[0], $nesting);
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'String');

    var $nesting = [self].concat($parent_nesting), $String_to_c$33;

    return ( nil) && 'to_c'
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/rational"] = function(Opal) {
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_times(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs * rhs : lhs['$*'](rhs);
  }
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  function $rb_le(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs <= rhs : lhs['$<='](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $module = Opal.module;

  
  self.$require("corelib/numeric");
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Rational');

    var $nesting = [self].concat($parent_nesting), $Rational_reduce$1, $Rational_convert$2, $Rational_initialize$3, $Rational_numerator$4, $Rational_denominator$5, $Rational_coerce$6, $Rational_$eq_eq$7, $Rational_$lt_eq_gt$8, $Rational_$plus$9, $Rational_$minus$10, $Rational_$$11, $Rational_$slash$12, $Rational_$$$13, $Rational_abs$14, $Rational_ceil$15, $Rational_floor$16, $Rational_hash$17, $Rational_inspect$18, $Rational_rationalize$19, $Rational_round$20, $Rational_to_f$21, $Rational_to_i$22, $Rational_to_r$23, $Rational_to_s$24, $Rational_truncate$25, $Rational_with_precision$26;

    self.$$prototype.num = self.$$prototype.den = nil;
    
    Opal.defs(self, '$reduce', $Rational_reduce$1 = function $$reduce(num, den) {
      var self = this, gcd = nil;

      
      num = num.$to_i();
      den = den.$to_i();
      if (den['$=='](0)) {
        self.$raise($$($nesting, 'ZeroDivisionError'), "divided by 0")
      } else if ($truthy($rb_lt(den, 0))) {
        
        num = num['$-@']();
        den = den['$-@']();
      } else if (den['$=='](1)) {
        return self.$new(num, den)};
      gcd = num.$gcd(den);
      return self.$new($rb_divide(num, gcd), $rb_divide(den, gcd));
    }, $Rational_reduce$1.$$arity = 2);
    Opal.defs(self, '$convert', $Rational_convert$2 = function $$convert(num, den) {
      var $a, $b, self = this;

      
      if ($truthy(($truthy($a = num['$nil?']()) ? $a : den['$nil?']()))) {
        self.$raise($$($nesting, 'TypeError'), "cannot convert nil into Rational")};
      if ($truthy(($truthy($a = $$($nesting, 'Integer')['$==='](num)) ? $$($nesting, 'Integer')['$==='](den) : $a))) {
        return self.$reduce(num, den)};
      if ($truthy(($truthy($a = ($truthy($b = $$($nesting, 'Float')['$==='](num)) ? $b : $$($nesting, 'String')['$==='](num))) ? $a : $$($nesting, 'Complex')['$==='](num)))) {
        num = num.$to_r()};
      if ($truthy(($truthy($a = ($truthy($b = $$($nesting, 'Float')['$==='](den)) ? $b : $$($nesting, 'String')['$==='](den))) ? $a : $$($nesting, 'Complex')['$==='](den)))) {
        den = den.$to_r()};
      if ($truthy(($truthy($a = den['$equal?'](1)) ? $$($nesting, 'Integer')['$==='](num)['$!']() : $a))) {
        return $$($nesting, 'Opal')['$coerce_to!'](num, $$($nesting, 'Rational'), "to_r")
      } else if ($truthy(($truthy($a = $$($nesting, 'Numeric')['$==='](num)) ? $$($nesting, 'Numeric')['$==='](den) : $a))) {
        return $rb_divide(num, den)
      } else {
        return self.$reduce(num, den)
      };
    }, $Rational_convert$2.$$arity = 2);
    
    Opal.def(self, '$initialize', $Rational_initialize$3 = function $$initialize(num, den) {
      var self = this;

      
      self.num = num;
      return (self.den = den);
    }, $Rational_initialize$3.$$arity = 2);
    
    Opal.def(self, '$numerator', $Rational_numerator$4 = function $$numerator() {
      var self = this;

      return self.num
    }, $Rational_numerator$4.$$arity = 0);
    
    Opal.def(self, '$denominator', $Rational_denominator$5 = function $$denominator() {
      var self = this;

      return self.den
    }, $Rational_denominator$5.$$arity = 0);
    
    Opal.def(self, '$coerce', $Rational_coerce$6 = function $$coerce(other) {
      var self = this, $case = nil;

      return (function() {$case = other;
      if ($$($nesting, 'Rational')['$===']($case)) {return [other, self]}
      else if ($$($nesting, 'Integer')['$===']($case)) {return [other.$to_r(), self]}
      else if ($$($nesting, 'Float')['$===']($case)) {return [other, self.$to_f()]}
      else { return nil }})()
    }, $Rational_coerce$6.$$arity = 1);
    
    Opal.def(self, '$==', $Rational_$eq_eq$7 = function(other) {
      var $a, self = this, $case = nil;

      return (function() {$case = other;
      if ($$($nesting, 'Rational')['$===']($case)) {return (($a = self.num['$=='](other.$numerator())) ? self.den['$=='](other.$denominator()) : self.num['$=='](other.$numerator()))}
      else if ($$($nesting, 'Integer')['$===']($case)) {return (($a = self.num['$=='](other)) ? self.den['$=='](1) : self.num['$=='](other))}
      else if ($$($nesting, 'Float')['$===']($case)) {return self.$to_f()['$=='](other)}
      else {return other['$=='](self)}})()
    }, $Rational_$eq_eq$7.$$arity = 1);
    
    Opal.def(self, '$<=>', $Rational_$lt_eq_gt$8 = function(other) {
      var self = this, $case = nil;

      return (function() {$case = other;
      if ($$($nesting, 'Rational')['$===']($case)) {return $rb_minus($rb_times(self.num, other.$denominator()), $rb_times(self.den, other.$numerator()))['$<=>'](0)}
      else if ($$($nesting, 'Integer')['$===']($case)) {return $rb_minus(self.num, $rb_times(self.den, other))['$<=>'](0)}
      else if ($$($nesting, 'Float')['$===']($case)) {return self.$to_f()['$<=>'](other)}
      else {return self.$__coerced__("<=>", other)}})()
    }, $Rational_$lt_eq_gt$8.$$arity = 1);
    
    Opal.def(self, '$+', $Rational_$plus$9 = function(other) {
      var self = this, $case = nil, num = nil, den = nil;

      return (function() {$case = other;
      if ($$($nesting, 'Rational')['$===']($case)) {
      num = $rb_plus($rb_times(self.num, other.$denominator()), $rb_times(self.den, other.$numerator()));
      den = $rb_times(self.den, other.$denominator());
      return self.$Rational(num, den);}
      else if ($$($nesting, 'Integer')['$===']($case)) {return self.$Rational($rb_plus(self.num, $rb_times(other, self.den)), self.den)}
      else if ($$($nesting, 'Float')['$===']($case)) {return $rb_plus(self.$to_f(), other)}
      else {return self.$__coerced__("+", other)}})()
    }, $Rational_$plus$9.$$arity = 1);
    
    Opal.def(self, '$-', $Rational_$minus$10 = function(other) {
      var self = this, $case = nil, num = nil, den = nil;

      return (function() {$case = other;
      if ($$($nesting, 'Rational')['$===']($case)) {
      num = $rb_minus($rb_times(self.num, other.$denominator()), $rb_times(self.den, other.$numerator()));
      den = $rb_times(self.den, other.$denominator());
      return self.$Rational(num, den);}
      else if ($$($nesting, 'Integer')['$===']($case)) {return self.$Rational($rb_minus(self.num, $rb_times(other, self.den)), self.den)}
      else if ($$($nesting, 'Float')['$===']($case)) {return $rb_minus(self.$to_f(), other)}
      else {return self.$__coerced__("-", other)}})()
    }, $Rational_$minus$10.$$arity = 1);
    
    Opal.def(self, '$*', $Rational_$$11 = function(other) {
      var self = this, $case = nil, num = nil, den = nil;

      return (function() {$case = other;
      if ($$($nesting, 'Rational')['$===']($case)) {
      num = $rb_times(self.num, other.$numerator());
      den = $rb_times(self.den, other.$denominator());
      return self.$Rational(num, den);}
      else if ($$($nesting, 'Integer')['$===']($case)) {return self.$Rational($rb_times(self.num, other), self.den)}
      else if ($$($nesting, 'Float')['$===']($case)) {return $rb_times(self.$to_f(), other)}
      else {return self.$__coerced__("*", other)}})()
    }, $Rational_$$11.$$arity = 1);
    
    Opal.def(self, '$/', $Rational_$slash$12 = function(other) {
      var self = this, $case = nil, num = nil, den = nil;

      return (function() {$case = other;
      if ($$($nesting, 'Rational')['$===']($case)) {
      num = $rb_times(self.num, other.$denominator());
      den = $rb_times(self.den, other.$numerator());
      return self.$Rational(num, den);}
      else if ($$($nesting, 'Integer')['$===']($case)) {if (other['$=='](0)) {
        return $rb_divide(self.$to_f(), 0.0)
      } else {
        return self.$Rational(self.num, $rb_times(self.den, other))
      }}
      else if ($$($nesting, 'Float')['$===']($case)) {return $rb_divide(self.$to_f(), other)}
      else {return self.$__coerced__("/", other)}})()
    }, $Rational_$slash$12.$$arity = 1);
    
    Opal.def(self, '$**', $Rational_$$$13 = function(other) {
      var $a, self = this, $case = nil;

      return (function() {$case = other;
      if ($$($nesting, 'Integer')['$===']($case)) {if ($truthy((($a = self['$=='](0)) ? $rb_lt(other, 0) : self['$=='](0)))) {
        return $$$($$($nesting, 'Float'), 'INFINITY')
      } else if ($truthy($rb_gt(other, 0))) {
        return self.$Rational(self.num['$**'](other), self.den['$**'](other))
      } else if ($truthy($rb_lt(other, 0))) {
        return self.$Rational(self.den['$**'](other['$-@']()), self.num['$**'](other['$-@']()))
      } else {
        return self.$Rational(1, 1)
      }}
      else if ($$($nesting, 'Float')['$===']($case)) {return self.$to_f()['$**'](other)}
      else if ($$($nesting, 'Rational')['$===']($case)) {if (other['$=='](0)) {
        return self.$Rational(1, 1)
      } else if (other.$denominator()['$=='](1)) {
        if ($truthy($rb_lt(other, 0))) {
          return self.$Rational(self.den['$**'](other.$numerator().$abs()), self.num['$**'](other.$numerator().$abs()))
        } else {
          return self.$Rational(self.num['$**'](other.$numerator()), self.den['$**'](other.$numerator()))
        }
      } else if ($truthy((($a = self['$=='](0)) ? $rb_lt(other, 0) : self['$=='](0)))) {
        return self.$raise($$($nesting, 'ZeroDivisionError'), "divided by 0")
      } else {
        return self.$to_f()['$**'](other)
      }}
      else {return self.$__coerced__("**", other)}})()
    }, $Rational_$$$13.$$arity = 1);
    
    Opal.def(self, '$abs', $Rational_abs$14 = function $$abs() {
      var self = this;

      return self.$Rational(self.num.$abs(), self.den.$abs())
    }, $Rational_abs$14.$$arity = 0);
    
    Opal.def(self, '$ceil', $Rational_ceil$15 = function $$ceil(precision) {
      var self = this;

      
      
      if (precision == null) {
        precision = 0;
      };
      if (precision['$=='](0)) {
        return $rb_divide(self.num['$-@'](), self.den)['$-@']().$ceil()
      } else {
        return self.$with_precision("ceil", precision)
      };
    }, $Rational_ceil$15.$$arity = -1);
    ;
    
    Opal.def(self, '$floor', $Rational_floor$16 = function $$floor(precision) {
      var self = this;

      
      
      if (precision == null) {
        precision = 0;
      };
      if (precision['$=='](0)) {
        return $rb_divide(self.num['$-@'](), self.den)['$-@']().$floor()
      } else {
        return self.$with_precision("floor", precision)
      };
    }, $Rational_floor$16.$$arity = -1);
    
    Opal.def(self, '$hash', $Rational_hash$17 = function $$hash() {
      var self = this;

      return "" + "Rational:" + (self.num) + ":" + (self.den)
    }, $Rational_hash$17.$$arity = 0);
    
    Opal.def(self, '$inspect', $Rational_inspect$18 = function $$inspect() {
      var self = this;

      return "" + "(" + (self) + ")"
    }, $Rational_inspect$18.$$arity = 0);
    Opal.alias(self, "quo", "/");
    
    Opal.def(self, '$rationalize', $Rational_rationalize$19 = function $$rationalize(eps) {
      var self = this;

      
      ;
      
      if (arguments.length > 1) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "wrong number of arguments (" + (arguments.length) + " for 0..1)");
      }

      if (eps == null) {
        return self;
      }

      var e = eps.$abs(),
          a = $rb_minus(self, e),
          b = $rb_plus(self, e);

      var p0 = 0,
          p1 = 1,
          q0 = 1,
          q1 = 0,
          p2, q2;

      var c, k, t;

      while (true) {
        c = (a).$ceil();

        if ($rb_le(c, b)) {
          break;
        }

        k  = c - 1;
        p2 = k * p1 + p0;
        q2 = k * q1 + q0;
        t  = $rb_divide(1, $rb_minus(b, k));
        b  = $rb_divide(1, $rb_minus(a, k));
        a  = t;

        p0 = p1;
        q0 = q1;
        p1 = p2;
        q1 = q2;
      }

      return self.$Rational(c * p1 + p0, c * q1 + q0);
    ;
    }, $Rational_rationalize$19.$$arity = -1);
    
    Opal.def(self, '$round', $Rational_round$20 = function $$round(precision) {
      var self = this, num = nil, den = nil, approx = nil;

      
      
      if (precision == null) {
        precision = 0;
      };
      if (precision['$=='](0)) {
      } else {
        return self.$with_precision("round", precision)
      };
      if (self.num['$=='](0)) {
        return 0};
      if (self.den['$=='](1)) {
        return self.num};
      num = $rb_plus($rb_times(self.num.$abs(), 2), self.den);
      den = $rb_times(self.den, 2);
      approx = $rb_divide(num, den).$truncate();
      if ($truthy($rb_lt(self.num, 0))) {
        return approx['$-@']()
      } else {
        return approx
      };
    }, $Rational_round$20.$$arity = -1);
    
    Opal.def(self, '$to_f', $Rational_to_f$21 = function $$to_f() {
      var self = this;

      return $rb_divide(self.num, self.den)
    }, $Rational_to_f$21.$$arity = 0);
    
    Opal.def(self, '$to_i', $Rational_to_i$22 = function $$to_i() {
      var self = this;

      return self.$truncate()
    }, $Rational_to_i$22.$$arity = 0);
    
    Opal.def(self, '$to_r', $Rational_to_r$23 = function $$to_r() {
      var self = this;

      return self
    }, $Rational_to_r$23.$$arity = 0);
    
    Opal.def(self, '$to_s', $Rational_to_s$24 = function $$to_s() {
      var self = this;

      return "" + (self.num) + "/" + (self.den)
    }, $Rational_to_s$24.$$arity = 0);
    
    Opal.def(self, '$truncate', $Rational_truncate$25 = function $$truncate(precision) {
      var self = this;

      
      
      if (precision == null) {
        precision = 0;
      };
      if (precision['$=='](0)) {
        if ($truthy($rb_lt(self.num, 0))) {
          return self.$ceil()
        } else {
          return self.$floor()
        }
      } else {
        return self.$with_precision("truncate", precision)
      };
    }, $Rational_truncate$25.$$arity = -1);
    return (Opal.def(self, '$with_precision', $Rational_with_precision$26 = function $$with_precision(method, precision) {
      var self = this, p = nil, s = nil;

      
      if ($truthy($$($nesting, 'Integer')['$==='](precision))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "not an Integer")
      };
      p = (10)['$**'](precision);
      s = $rb_times(self, p);
      if ($truthy($rb_lt(precision, 1))) {
        return $rb_divide(s.$send(method), p).$to_i()
      } else {
        return self.$Rational(s.$send(method), p)
      };
    }, $Rational_with_precision$26.$$arity = 2), nil) && 'with_precision';
  })($nesting[0], $$($nesting, 'Numeric'), $nesting);
  (function($base, $parent_nesting) {
    var self = $module($base, 'Kernel');

    var $nesting = [self].concat($parent_nesting), $Kernel_Rational$27;

    
    Opal.def(self, '$Rational', $Kernel_Rational$27 = function $$Rational(numerator, denominator) {
      var self = this;

      
      
      if (denominator == null) {
        denominator = 1;
      };
      return $$($nesting, 'Rational').$convert(numerator, denominator);
    }, $Kernel_Rational$27.$$arity = -2)
  })($nesting[0], $nesting);
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'String');

    var $nesting = [self].concat($parent_nesting), $String_to_r$28;

    return (Opal.def(self, '$to_r', $String_to_r$28 = function $$to_r() {
      var self = this;

      
      var str = self.trimLeft(),
          re = /^[+-]?[\d_]+(\.[\d_]+)?/,
          match = str.match(re),
          numerator, denominator;

      function isFloat() {
        return re.test(str);
      }

      function cutFloat() {
        var match = str.match(re);
        var number = match[0];
        str = str.slice(number.length);
        return number.replace(/_/g, '');
      }

      if (isFloat()) {
        numerator = parseFloat(cutFloat());

        if (str[0] === '/') {
          // rational real part
          str = str.slice(1);

          if (isFloat()) {
            denominator = parseFloat(cutFloat());
            return self.$Rational(numerator, denominator);
          } else {
            return self.$Rational(numerator, 1);
          }
        } else {
          return self.$Rational(numerator, 1);
        }
      } else {
        return self.$Rational(0, 1);
      }
    
    }, $String_to_r$28.$$arity = 0), nil) && 'to_r'
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/time"] = function(Opal) {
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_le(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs <= rhs : lhs['$<='](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $slice = Opal.slice, $klass = Opal.klass, $truthy = Opal.truthy, $range = Opal.range;

  
  self.$require("corelib/comparable");
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Time');

    var $nesting = [self].concat($parent_nesting), $Time_at$1, $Time_new$2, $Time_local$3, $Time_gm$4, $Time_now$5, $Time_$plus$6, $Time_$minus$7, $Time_$lt_eq_gt$8, $Time_$eq_eq$9, $Time_asctime$10, $Time_day$11, $Time_yday$12, $Time_isdst$13, $Time_dup$14, $Time_eql$ques$15, $Time_friday$ques$16, $Time_hash$17, $Time_hour$18, $Time_inspect$19, $Time_min$20, $Time_mon$21, $Time_monday$ques$22, $Time_saturday$ques$23, $Time_sec$24, $Time_succ$25, $Time_usec$26, $Time_zone$27, $Time_getgm$28, $Time_gmtime$29, $Time_gmt$ques$30, $Time_gmt_offset$31, $Time_strftime$32, $Time_sunday$ques$33, $Time_thursday$ques$34, $Time_to_a$35, $Time_to_f$36, $Time_to_i$37, $Time_tuesday$ques$38, $Time_wday$39, $Time_wednesday$ques$40, $Time_year$41, $Time_cweek_cyear$42;

    
    self.$include($$($nesting, 'Comparable'));
    
    var days_of_week = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        short_days   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        short_months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        long_months  = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  ;
    ;
    
    function time_params(year, month, day, hour, min, sec) {
      if (year.$$is_string) {
        year = parseInt(year, 10);
      } else {
        year = $$($nesting, 'Opal')['$coerce_to!'](year, $$($nesting, 'Integer'), "to_int");
      }

      if (month === nil) {
        month = 1;
      } else if (!month.$$is_number) {
        if ((month)['$respond_to?']("to_str")) {
          month = (month).$to_str();
          switch (month.toLowerCase()) {
          case 'jan': month =  1; break;
          case 'feb': month =  2; break;
          case 'mar': month =  3; break;
          case 'apr': month =  4; break;
          case 'may': month =  5; break;
          case 'jun': month =  6; break;
          case 'jul': month =  7; break;
          case 'aug': month =  8; break;
          case 'sep': month =  9; break;
          case 'oct': month = 10; break;
          case 'nov': month = 11; break;
          case 'dec': month = 12; break;
          default: month = (month).$to_i();
          }
        } else {
          month = $$($nesting, 'Opal')['$coerce_to!'](month, $$($nesting, 'Integer'), "to_int");
        }
      }

      if (month < 1 || month > 12) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "month out of range: " + (month))
      }
      month = month - 1;

      if (day === nil) {
        day = 1;
      } else if (day.$$is_string) {
        day = parseInt(day, 10);
      } else {
        day = $$($nesting, 'Opal')['$coerce_to!'](day, $$($nesting, 'Integer'), "to_int");
      }

      if (day < 1 || day > 31) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "day out of range: " + (day))
      }

      if (hour === nil) {
        hour = 0;
      } else if (hour.$$is_string) {
        hour = parseInt(hour, 10);
      } else {
        hour = $$($nesting, 'Opal')['$coerce_to!'](hour, $$($nesting, 'Integer'), "to_int");
      }

      if (hour < 0 || hour > 24) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "hour out of range: " + (hour))
      }

      if (min === nil) {
        min = 0;
      } else if (min.$$is_string) {
        min = parseInt(min, 10);
      } else {
        min = $$($nesting, 'Opal')['$coerce_to!'](min, $$($nesting, 'Integer'), "to_int");
      }

      if (min < 0 || min > 59) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "min out of range: " + (min))
      }

      if (sec === nil) {
        sec = 0;
      } else if (!sec.$$is_number) {
        if (sec.$$is_string) {
          sec = parseInt(sec, 10);
        } else {
          sec = $$($nesting, 'Opal')['$coerce_to!'](sec, $$($nesting, 'Integer'), "to_int");
        }
      }

      if (sec < 0 || sec > 60) {
        self.$raise($$($nesting, 'ArgumentError'), "" + "sec out of range: " + (sec))
      }

      return [year, month, day, hour, min, sec];
    }
  ;
    Opal.defs(self, '$new', $Time_new$2 = function(year, month, day, hour, min, sec, utc_offset) {
      var self = this;

      
      ;
      
      if (month == null) {
        month = nil;
      };
      
      if (day == null) {
        day = nil;
      };
      
      if (hour == null) {
        hour = nil;
      };
      
      if (min == null) {
        min = nil;
      };
      
      if (sec == null) {
        sec = nil;
      };
      
      if (utc_offset == null) {
        utc_offset = nil;
      };
      
      var args, result;

      if (year === undefined) {
        return new Date();
      }

      if (utc_offset !== nil) {
        self.$raise($$($nesting, 'ArgumentError'), "Opal does not support explicitly specifying UTC offset for Time")
      }

      args  = time_params(year, month, day, hour, min, sec);
      year  = args[0];
      month = args[1];
      day   = args[2];
      hour  = args[3];
      min   = args[4];
      sec   = args[5];

      result = new Date(year, month, day, hour, min, 0, sec * 1000);
      if (year < 100) {
        result.setFullYear(year);
      }
      return result;
    ;
    }, $Time_new$2.$$arity = -1);
    ;
    ;
    (function(self, $parent_nesting) {
      var $nesting = [self].concat($parent_nesting);

      
      ;
      return ;
    })(Opal.get_singleton_class(self), $nesting);
    ;
    
    Opal.def(self, '$+', $Time_$plus$6 = function(other) {
      var self = this;

      
      if ($truthy($$($nesting, 'Time')['$==='](other))) {
        self.$raise($$($nesting, 'TypeError'), "time + time?")};
      
      if (!other.$$is_number) {
        other = $$($nesting, 'Opal')['$coerce_to!'](other, $$($nesting, 'Integer'), "to_int");
      }
      var result = new Date(self.getTime() + (other * 1000));
      result.is_utc = self.is_utc;
      return result;
    ;
    }, $Time_$plus$6.$$arity = 1);
    
    Opal.def(self, '$-', $Time_$minus$7 = function(other) {
      var self = this;

      
      if ($truthy($$($nesting, 'Time')['$==='](other))) {
        return (self.getTime() - other.getTime()) / 1000};
      
      if (!other.$$is_number) {
        other = $$($nesting, 'Opal')['$coerce_to!'](other, $$($nesting, 'Integer'), "to_int");
      }
      var result = new Date(self.getTime() - (other * 1000));
      result.is_utc = self.is_utc;
      return result;
    ;
    }, $Time_$minus$7.$$arity = 1);
    
    Opal.def(self, '$<=>', $Time_$lt_eq_gt$8 = function(other) {
      var self = this, r = nil;

      if ($truthy($$($nesting, 'Time')['$==='](other))) {
        return self.$to_f()['$<=>'](other.$to_f())
      } else {
        
        r = other['$<=>'](self);
        if ($truthy(r['$nil?']())) {
          return nil
        } else if ($truthy($rb_gt(r, 0))) {
          return -1
        } else if ($truthy($rb_lt(r, 0))) {
          return 1
        } else {
          return 0
        };
      }
    }, $Time_$lt_eq_gt$8.$$arity = 1);
    
    Opal.def(self, '$==', $Time_$eq_eq$9 = function(other) {
      var $a, self = this;

      return ($truthy($a = $$($nesting, 'Time')['$==='](other)) ? self.$to_f() === other.$to_f() : $a)
    }, $Time_$eq_eq$9.$$arity = 1);
    
    ;
    ;
    
    Opal.def(self, '$day', $Time_day$11 = function $$day() {
      var self = this;

      return self.is_utc ? self.getUTCDate() : self.getDate();
    }, $Time_day$11.$$arity = 0);
    
    Opal.def(self, '$yday', $Time_yday$12 = function $$yday() {
      var self = this, start_of_year = nil, start_of_day = nil, one_day = nil;

      
      start_of_year = $$($nesting, 'Time').$new(self.$year()).$to_i();
      start_of_day = $$($nesting, 'Time').$new(self.$year(), self.$month(), self.$day()).$to_i();
      one_day = 86400;
      return $rb_plus($rb_divide($rb_minus(start_of_day, start_of_year), one_day).$round(), 1);
    }, $Time_yday$12.$$arity = 0);
    
    Opal.def(self, '$isdst', $Time_isdst$13 = function $$isdst() {
      var self = this;

      
      var jan = new Date(self.getFullYear(), 0, 1),
          jul = new Date(self.getFullYear(), 6, 1);
      return self.getTimezoneOffset() < Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
    
    }, $Time_isdst$13.$$arity = 0);
    ;
    
    Opal.def(self, '$dup', $Time_dup$14 = function $$dup() {
      var self = this, copy = nil;

      
      copy = new Date(self.getTime());
      copy.$copy_instance_variables(self);
      copy.$initialize_dup(self);
      return copy;
    }, $Time_dup$14.$$arity = 0);
    
    Opal.def(self, '$eql?', $Time_eql$ques$15 = function(other) {
      var $a, self = this;

      return ($truthy($a = other['$is_a?']($$($nesting, 'Time'))) ? self['$<=>'](other)['$zero?']() : $a)
    }, $Time_eql$ques$15.$$arity = 1);
    
    ;
    
    Opal.def(self, '$hash', $Time_hash$17 = function $$hash() {
      var self = this;

      return 'Time:' + self.getTime();
    }, $Time_hash$17.$$arity = 0);
    
    Opal.def(self, '$hour', $Time_hour$18 = function $$hour() {
      var self = this;

      return self.is_utc ? self.getUTCHours() : self.getHours();
    }, $Time_hour$18.$$arity = 0);
    
    Opal.def(self, '$inspect', $Time_inspect$19 = function $$inspect() {
      var self = this;

      if ($truthy(self['$utc?']())) {
        return self.$strftime("%Y-%m-%d %H:%M:%S UTC")
      } else {
        return self.$strftime("%Y-%m-%d %H:%M:%S %z")
      }
    }, $Time_inspect$19.$$arity = 0);
    ;
    
    Opal.def(self, '$min', $Time_min$20 = function $$min() {
      var self = this;

      return self.is_utc ? self.getUTCMinutes() : self.getMinutes();
    }, $Time_min$20.$$arity = 0);
    
    Opal.def(self, '$mon', $Time_mon$21 = function $$mon() {
      var self = this;

      return (self.is_utc ? self.getUTCMonth() : self.getMonth()) + 1;
    }, $Time_mon$21.$$arity = 0);
    
    ;
    Opal.alias(self, "month", "mon");
    
    ;
    
    Opal.def(self, '$sec', $Time_sec$24 = function $$sec() {
      var self = this;

      return self.is_utc ? self.getUTCSeconds() : self.getSeconds();
    }, $Time_sec$24.$$arity = 0);
    
    Opal.def(self, '$succ', $Time_succ$25 = function $$succ() {
      var self = this;

      
      var result = new Date(self.getTime() + 1000);
      result.is_utc = self.is_utc;
      return result;
    
    }, $Time_succ$25.$$arity = 0);
    
    ;
    
    Opal.def(self, '$zone', $Time_zone$27 = function $$zone() {
      var self = this;

      
      var string = self.toString(),
          result;

      if (string.indexOf('(') == -1) {
        result = string.match(/[A-Z]{3,4}/)[0];
      }
      else {
        result = string.match(/\((.+)\)(?:\s|$)/)[1]
      }

      if (result == "GMT" && /(GMT\W*\d{4})/.test(string)) {
        return RegExp.$1;
      }
      else {
        return result;
      }
    
    }, $Time_zone$27.$$arity = 0);
    
    ;
    ;
    
    ;
    ;
    
    Opal.def(self, '$gmt?', $Time_gmt$ques$30 = function() {
      var self = this;

      return self.is_utc === true;
    }, $Time_gmt$ques$30.$$arity = 0);
    
    ;
    
    Opal.def(self, '$strftime', $Time_strftime$32 = function $$strftime(format) {
      var self = this;

      
      return format.replace(/%([\-_#^0]*:{0,2})(\d+)?([EO]*)(.)/g, function(full, flags, width, _, conv) {
        var result = "",
            zero   = flags.indexOf('0') !== -1,
            pad    = flags.indexOf('-') === -1,
            blank  = flags.indexOf('_') !== -1,
            upcase = flags.indexOf('^') !== -1,
            invert = flags.indexOf('#') !== -1,
            colons = (flags.match(':') || []).length;

        width = parseInt(width, 10);

        if (zero && blank) {
          if (flags.indexOf('0') < flags.indexOf('_')) {
            zero = false;
          }
          else {
            blank = false;
          }
        }

        switch (conv) {
          case 'Y':
            result += self.$year();
            break;

          case 'C':
            zero    = !blank;
            result += Math.round(self.$year() / 100);
            break;

          case 'y':
            zero    = !blank;
            result += (self.$year() % 100);
            break;

          case 'm':
            zero    = !blank;
            result += self.$mon();
            break;

          case 'B':
            result += long_months[self.$mon() - 1];
            break;

          case 'b':
          case 'h':
            blank   = !zero;
            result += short_months[self.$mon() - 1];
            break;

          case 'd':
            zero    = !blank
            result += self.$day();
            break;

          case 'e':
            blank   = !zero
            result += self.$day();
            break;

          case 'j':
            result += self.$yday();
            break;

          case 'H':
            zero    = !blank;
            result += self.$hour();
            break;

          case 'k':
            blank   = !zero;
            result += self.$hour();
            break;

          case 'I':
            zero    = !blank;
            result += (self.$hour() % 12 || 12);
            break;

          case 'l':
            blank   = !zero;
            result += (self.$hour() % 12 || 12);
            break;

          case 'P':
            result += (self.$hour() >= 12 ? "pm" : "am");
            break;

          case 'p':
            result += (self.$hour() >= 12 ? "PM" : "AM");
            break;

          case 'M':
            zero    = !blank;
            result += self.$min();
            break;

          case 'S':
            zero    = !blank;
            result += self.$sec()
            break;

          case 'L':
            zero    = !blank;
            width   = isNaN(width) ? 3 : width;
            result += self.getMilliseconds();
            break;

          case 'N':
            width   = isNaN(width) ? 9 : width;
            result += (self.getMilliseconds().toString()).$rjust(3, "0");
            result  = (result).$ljust(width, "0");
            break;

          case 'z':
            var offset  = self.getTimezoneOffset(),
                hours   = Math.floor(Math.abs(offset) / 60),
                minutes = Math.abs(offset) % 60;

            result += offset < 0 ? "+" : "-";
            result += hours < 10 ? "0" : "";
            result += hours;

            if (colons > 0) {
              result += ":";
            }

            result += minutes < 10 ? "0" : "";
            result += minutes;

            if (colons > 1) {
              result += ":00";
            }

            break;

          case 'Z':
            result += self.$zone();
            break;

          case 'A':
            result += days_of_week[self.$wday()];
            break;

          case 'a':
            result += short_days[self.$wday()];
            break;

          case 'u':
            result += (self.$wday() + 1);
            break;

          case 'w':
            result += self.$wday();
            break;

          case 'V':
            result += self.$cweek_cyear()['$[]'](0).$to_s().$rjust(2, "0");
            break;

          case 'G':
            result += self.$cweek_cyear()['$[]'](1);
            break;

          case 'g':
            result += self.$cweek_cyear()['$[]'](1)['$[]']($range(-2, -1, false));
            break;

          case 's':
            result += self.$to_i();
            break;

          case 'n':
            result += "\n";
            break;

          case 't':
            result += "\t";
            break;

          case '%':
            result += "%";
            break;

          case 'c':
            result += self.$strftime("%a %b %e %T %Y");
            break;

          case 'D':
          case 'x':
            result += self.$strftime("%m/%d/%y");
            break;

          case 'F':
            result += self.$strftime("%Y-%m-%d");
            break;

          case 'v':
            result += self.$strftime("%e-%^b-%4Y");
            break;

          case 'r':
            result += self.$strftime("%I:%M:%S %p");
            break;

          case 'R':
            result += self.$strftime("%H:%M");
            break;

          case 'T':
          case 'X':
            result += self.$strftime("%H:%M:%S");
            break;

          default:
            return full;
        }

        if (upcase) {
          result = result.toUpperCase();
        }

        if (invert) {
          result = result.replace(/[A-Z]/, function(c) { c.toLowerCase() }).
                          replace(/[a-z]/, function(c) { c.toUpperCase() });
        }

        if (pad && (zero || blank)) {
          result = (result).$rjust(isNaN(width) ? 2 : width, blank ? " " : "0");
        }

        return result;
      });
    
    }, $Time_strftime$32.$$arity = 1);
    
    ;
    
    ;
    
    Opal.def(self, '$to_a', $Time_to_a$35 = function $$to_a() {
      var self = this;

      return [self.$sec(), self.$min(), self.$hour(), self.$day(), self.$month(), self.$year(), self.$wday(), self.$yday(), self.$isdst(), self.$zone()]
    }, $Time_to_a$35.$$arity = 0);
    
    Opal.def(self, '$to_f', $Time_to_f$36 = function $$to_f() {
      var self = this;

      return self.getTime() / 1000;
    }, $Time_to_f$36.$$arity = 0);
    
    Opal.def(self, '$to_i', $Time_to_i$37 = function $$to_i() {
      var self = this;

      return parseInt(self.getTime() / 1000, 10);
    }, $Time_to_i$37.$$arity = 0);
    Opal.alias(self, "to_s", "inspect");
    
    ;
    ;
    ;
    Opal.alias(self, "utc?", "gmt?");
    ;
    ;
    
    Opal.def(self, '$wday', $Time_wday$39 = function $$wday() {
      var self = this;

      return self.is_utc ? self.getUTCDay() : self.getDay();
    }, $Time_wday$39.$$arity = 0);
    
    ;
    
    Opal.def(self, '$year', $Time_year$41 = function $$year() {
      var self = this;

      return self.is_utc ? self.getUTCFullYear() : self.getFullYear();
    }, $Time_year$41.$$arity = 0);
    return (Opal.def(self, '$cweek_cyear', $Time_cweek_cyear$42 = function $$cweek_cyear() {
      var $a, self = this, jan01 = nil, jan01_wday = nil, first_monday = nil, year = nil, offset = nil, week = nil, dec31 = nil, dec31_wday = nil;

      
      jan01 = $$($nesting, 'Time').$new(self.$year(), 1, 1);
      jan01_wday = jan01.$wday();
      first_monday = 0;
      year = self.$year();
      if ($truthy(($truthy($a = $rb_le(jan01_wday, 4)) ? jan01_wday['$!='](0) : $a))) {
        offset = $rb_minus(jan01_wday, 1)
      } else {
        
        offset = $rb_minus($rb_minus(jan01_wday, 7), 1);
        if (offset['$=='](-8)) {
          offset = -1};
      };
      week = $rb_divide($rb_plus(self.$yday(), offset), 7.0).$ceil();
      if ($truthy($rb_le(week, 0))) {
        return $$($nesting, 'Time').$new($rb_minus(self.$year(), 1), 12, 31).$cweek_cyear()
      } else if (week['$=='](53)) {
        
        dec31 = $$($nesting, 'Time').$new(self.$year(), 12, 31);
        dec31_wday = dec31.$wday();
        if ($truthy(($truthy($a = $rb_le(dec31_wday, 3)) ? dec31_wday['$!='](0) : $a))) {
          
          week = 1;
          year = $rb_plus(year, 1);};};
      return [week, year];
    }, $Time_cweek_cyear$42.$$arity = 0), nil) && 'cweek_cyear';
  })($nesting[0], Date, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/struct"] = function(Opal) {
  function $rb_gt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs > rhs : lhs['$>'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  function $rb_ge(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs >= rhs : lhs['$>='](rhs);
  }
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $hash2 = Opal.hash2, $truthy = Opal.truthy, $send = Opal.send;

  
  self.$require("corelib/enumerable");
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Struct');

    var $nesting = [self].concat($parent_nesting), $Struct_new$1, $Struct_define_struct_attribute$6, $Struct_members$9, $Struct_inherited$10, $Struct_initialize$12, $Struct_initialize_copy$15, $Struct_members$16, $Struct_hash$17, $Struct_$$$18, $Struct_$$$eq$19, $Struct_$eq_eq$20, $Struct_eql$ques$21, $Struct_each$22, $Struct_each_pair$25, $Struct_length$28, $Struct_to_a$29, $Struct_inspect$31, $Struct_to_h$33, $Struct_values_at$35, $Struct_dig$37;

    
    self.$include($$($nesting, 'Enumerable'));
    Opal.defs(self, '$new', $Struct_new$1 = function(const_name, $a, $b) {
      var $iter = $Struct_new$1.$$p, block = $iter || nil, $post_args, $kwargs, args, keyword_init, $$2, $$3, self = this, klass = nil;

      if ($iter) $Struct_new$1.$$p = null;
      
      
      if ($iter) $Struct_new$1.$$p = null;;
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      $kwargs = Opal.extract_kwargs($post_args);
      
      if ($kwargs == null) {
        $kwargs = $hash2([], {});
      } else if (!$kwargs.$$is_hash) {
        throw Opal.ArgumentError.$new('expected kwargs');
      };
      
      args = $post_args;;
      
      keyword_init = $kwargs.$$smap["keyword_init"];
      if (keyword_init == null) {
        keyword_init = false
      };
      if ($truthy(const_name)) {
        
        try {
          const_name = $$($nesting, 'Opal')['$const_name!'](const_name)
        } catch ($err) {
          if (Opal.rescue($err, [$$($nesting, 'TypeError'), $$($nesting, 'NameError')])) {
            try {
              
              args.$unshift(const_name);
              const_name = nil;
            } finally { Opal.pop_exception() }
          } else { throw $err; }
        };};
      $send(args, 'map', [], ($$2 = function(arg){var self = $$2.$$s == null ? this : $$2.$$s;

      
        
        if (arg == null) {
          arg = nil;
        };
        return $$($nesting, 'Opal')['$coerce_to!'](arg, $$($nesting, 'String'), "to_str");}, $$2.$$s = self, $$2.$$arity = 1, $$2));
      klass = $send($$($nesting, 'Class'), 'new', [self], ($$3 = function(){var self = $$3.$$s == null ? this : $$3.$$s, $$4;

      
        $send(args, 'each', [], ($$4 = function(arg){var self = $$4.$$s == null ? this : $$4.$$s;

        
          
          if (arg == null) {
            arg = nil;
          };
          return self.$define_struct_attribute(arg);}, $$4.$$s = self, $$4.$$arity = 1, $$4));
        return (function(self, $parent_nesting) {
          var $nesting = [self].concat($parent_nesting), $new$5;

          
          
          Opal.def(self, '$new', $new$5 = function($a) {
            var $post_args, args, self = this, instance = nil;

            
            
            $post_args = Opal.slice.call(arguments, 0, arguments.length);
            
            args = $post_args;;
            instance = self.$allocate();
            instance.$$data = {};
            $send(instance, 'initialize', Opal.to_a(args));
            return instance;
          }, $new$5.$$arity = -1);
          return self.$alias_method("[]", "new");
        })(Opal.get_singleton_class(self), $nesting);}, $$3.$$s = self, $$3.$$arity = 0, $$3));
      if ($truthy(block)) {
        $send(klass, 'module_eval', [], block.$to_proc())};
      klass.$$keyword_init = keyword_init;
      if ($truthy(const_name)) {
        $$($nesting, 'Struct').$const_set(const_name, klass)};
      return klass;
    }, $Struct_new$1.$$arity = -2);
    Opal.defs(self, '$define_struct_attribute', $Struct_define_struct_attribute$6 = function $$define_struct_attribute(name) {
      var $$7, $$8, self = this;

      
      if (self['$==']($$($nesting, 'Struct'))) {
        self.$raise($$($nesting, 'ArgumentError'), "you cannot define attributes to the Struct class")};
      self.$members()['$<<'](name);
      $send(self, 'define_method', [name], ($$7 = function(){var self = $$7.$$s == null ? this : $$7.$$s;

      return self.$$data[name];}, $$7.$$s = self, $$7.$$arity = 0, $$7));
      return $send(self, 'define_method', ["" + (name) + "="], ($$8 = function(value){var self = $$8.$$s == null ? this : $$8.$$s;

      
        
        if (value == null) {
          value = nil;
        };
        return self.$$data[name] = value;;}, $$8.$$s = self, $$8.$$arity = 1, $$8));
    }, $Struct_define_struct_attribute$6.$$arity = 1);
    Opal.defs(self, '$members', $Struct_members$9 = function $$members() {
      var $a, self = this;
      if (self.members == null) self.members = nil;

      
      if (self['$==']($$($nesting, 'Struct'))) {
        self.$raise($$($nesting, 'ArgumentError'), "the Struct class has no members")};
      return (self.members = ($truthy($a = self.members) ? $a : []));
    }, $Struct_members$9.$$arity = 0);
    Opal.defs(self, '$inherited', $Struct_inherited$10 = function $$inherited(klass) {
      var $$11, self = this, members = nil;
      if (self.members == null) self.members = nil;

      
      members = self.members;
      return $send(klass, 'instance_eval', [], ($$11 = function(){var self = $$11.$$s == null ? this : $$11.$$s;

      return (self.members = members)}, $$11.$$s = self, $$11.$$arity = 0, $$11));
    }, $Struct_inherited$10.$$arity = 1);
    
    Opal.def(self, '$initialize', $Struct_initialize$12 = function $$initialize($a) {
      var $post_args, args, $b, $$13, $$14, self = this, kwargs = nil, extra = nil;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      
      args = $post_args;;
      if ($truthy(self.$class().$$keyword_init)) {
        
        kwargs = ($truthy($b = args.$last()) ? $b : $hash2([], {}));
        if ($truthy(($truthy($b = $rb_gt(args.$length(), 1)) ? $b : (args.length === 1 && !kwargs.$$is_hash)))) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "wrong number of arguments (given " + (args.$length()) + ", expected 0)")};
        extra = $rb_minus(kwargs.$keys(), self.$class().$members());
        if ($truthy(extra['$any?']())) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "unknown keywords: " + (extra.$join(", ")))};
        return $send(self.$class().$members(), 'each', [], ($$13 = function(name){var self = $$13.$$s == null ? this : $$13.$$s, $writer = nil;

        
          
          if (name == null) {
            name = nil;
          };
          $writer = [name, kwargs['$[]'](name)];
          $send(self, '[]=', Opal.to_a($writer));
          return $writer[$rb_minus($writer["length"], 1)];}, $$13.$$s = self, $$13.$$arity = 1, $$13));
      } else {
        
        if ($truthy($rb_gt(args.$length(), self.$class().$members().$length()))) {
          self.$raise($$($nesting, 'ArgumentError'), "struct size differs")};
        return $send(self.$class().$members(), 'each_with_index', [], ($$14 = function(name, index){var self = $$14.$$s == null ? this : $$14.$$s, $writer = nil;

        
          
          if (name == null) {
            name = nil;
          };
          
          if (index == null) {
            index = nil;
          };
          $writer = [name, args['$[]'](index)];
          $send(self, '[]=', Opal.to_a($writer));
          return $writer[$rb_minus($writer["length"], 1)];}, $$14.$$s = self, $$14.$$arity = 2, $$14));
      };
    }, $Struct_initialize$12.$$arity = -1);
    
    Opal.def(self, '$initialize_copy', $Struct_initialize_copy$15 = function $$initialize_copy(from) {
      var self = this;

      
      self.$$data = {}
      var keys = Object.keys(from.$$data), i, max, name;
      for (i = 0, max = keys.length; i < max; i++) {
        name = keys[i];
        self.$$data[name] = from.$$data[name];
      }
    
    }, $Struct_initialize_copy$15.$$arity = 1);
    
    Opal.def(self, '$members', $Struct_members$16 = function $$members() {
      var self = this;

      return self.$class().$members()
    }, $Struct_members$16.$$arity = 0);
    
    Opal.def(self, '$hash', $Struct_hash$17 = function $$hash() {
      var self = this;

      return $$($nesting, 'Hash').$new(self.$$data).$hash()
    }, $Struct_hash$17.$$arity = 0);
    
    Opal.def(self, '$[]', $Struct_$$$18 = function(name) {
      var self = this;

      
      if ($truthy($$($nesting, 'Integer')['$==='](name))) {
        
        if ($truthy($rb_lt(name, self.$class().$members().$size()['$-@']()))) {
          self.$raise($$($nesting, 'IndexError'), "" + "offset " + (name) + " too small for struct(size:" + (self.$class().$members().$size()) + ")")};
        if ($truthy($rb_ge(name, self.$class().$members().$size()))) {
          self.$raise($$($nesting, 'IndexError'), "" + "offset " + (name) + " too large for struct(size:" + (self.$class().$members().$size()) + ")")};
        name = self.$class().$members()['$[]'](name);
      } else if ($truthy($$($nesting, 'String')['$==='](name))) {
        
        if(!self.$$data.hasOwnProperty(name)) {
          self.$raise($$($nesting, 'NameError').$new("" + "no member '" + (name) + "' in struct", name))
        }
      
      } else {
        self.$raise($$($nesting, 'TypeError'), "" + "no implicit conversion of " + (name.$class()) + " into Integer")
      };
      name = $$($nesting, 'Opal')['$coerce_to!'](name, $$($nesting, 'String'), "to_str");
      return self.$$data[name];;
    }, $Struct_$$$18.$$arity = 1);
    
    Opal.def(self, '$[]=', $Struct_$$$eq$19 = function(name, value) {
      var self = this;

      
      if ($truthy($$($nesting, 'Integer')['$==='](name))) {
        
        if ($truthy($rb_lt(name, self.$class().$members().$size()['$-@']()))) {
          self.$raise($$($nesting, 'IndexError'), "" + "offset " + (name) + " too small for struct(size:" + (self.$class().$members().$size()) + ")")};
        if ($truthy($rb_ge(name, self.$class().$members().$size()))) {
          self.$raise($$($nesting, 'IndexError'), "" + "offset " + (name) + " too large for struct(size:" + (self.$class().$members().$size()) + ")")};
        name = self.$class().$members()['$[]'](name);
      } else if ($truthy($$($nesting, 'String')['$==='](name))) {
        if ($truthy(self.$class().$members()['$include?'](name.$to_sym()))) {
        } else {
          self.$raise($$($nesting, 'NameError').$new("" + "no member '" + (name) + "' in struct", name))
        }
      } else {
        self.$raise($$($nesting, 'TypeError'), "" + "no implicit conversion of " + (name.$class()) + " into Integer")
      };
      name = $$($nesting, 'Opal')['$coerce_to!'](name, $$($nesting, 'String'), "to_str");
      return self.$$data[name] = value;;
    }, $Struct_$$$eq$19.$$arity = 2);
    
    Opal.def(self, '$==', $Struct_$eq_eq$20 = function(other) {
      var self = this;

      
      if ($truthy(other['$instance_of?'](self.$class()))) {
      } else {
        return false
      };
      
      var recursed1 = {}, recursed2 = {};

      function _eqeq(struct, other) {
        var key, a, b;

        recursed1[(struct).$__id__()] = true;
        recursed2[(other).$__id__()] = true;

        for (key in struct.$$data) {
          a = struct.$$data[key];
          b = other.$$data[key];

          if ($$($nesting, 'Struct')['$==='](a)) {
            if (!recursed1.hasOwnProperty((a).$__id__()) || !recursed2.hasOwnProperty((b).$__id__())) {
              if (!_eqeq(a, b)) {
                return false;
              }
            }
          } else {
            if (!(a)['$=='](b)) {
              return false;
            }
          }
        }

        return true;
      }

      return _eqeq(self, other);
    ;
    }, $Struct_$eq_eq$20.$$arity = 1);
    
    Opal.def(self, '$eql?', $Struct_eql$ques$21 = function(other) {
      var self = this;

      
      if ($truthy(other['$instance_of?'](self.$class()))) {
      } else {
        return false
      };
      
      var recursed1 = {}, recursed2 = {};

      function _eqeq(struct, other) {
        var key, a, b;

        recursed1[(struct).$__id__()] = true;
        recursed2[(other).$__id__()] = true;

        for (key in struct.$$data) {
          a = struct.$$data[key];
          b = other.$$data[key];

          if ($$($nesting, 'Struct')['$==='](a)) {
            if (!recursed1.hasOwnProperty((a).$__id__()) || !recursed2.hasOwnProperty((b).$__id__())) {
              if (!_eqeq(a, b)) {
                return false;
              }
            }
          } else {
            if (!(a)['$eql?'](b)) {
              return false;
            }
          }
        }

        return true;
      }

      return _eqeq(self, other);
    ;
    }, $Struct_eql$ques$21.$$arity = 1);
    
    Opal.def(self, '$each', $Struct_each$22 = function $$each() {
      var $$23, $$24, $iter = $Struct_each$22.$$p, $yield = $iter || nil, self = this;

      if ($iter) $Struct_each$22.$$p = null;
      
      if (($yield !== nil)) {
      } else {
        return $send(self, 'enum_for', ["each"], ($$23 = function(){var self = $$23.$$s == null ? this : $$23.$$s;

        return self.$size()}, $$23.$$s = self, $$23.$$arity = 0, $$23))
      };
      $send(self.$class().$members(), 'each', [], ($$24 = function(name){var self = $$24.$$s == null ? this : $$24.$$s;

      
        
        if (name == null) {
          name = nil;
        };
        return Opal.yield1($yield, self['$[]'](name));;}, $$24.$$s = self, $$24.$$arity = 1, $$24));
      return self;
    }, $Struct_each$22.$$arity = 0);
    
    Opal.def(self, '$each_pair', $Struct_each_pair$25 = function $$each_pair() {
      var $$26, $$27, $iter = $Struct_each_pair$25.$$p, $yield = $iter || nil, self = this;

      if ($iter) $Struct_each_pair$25.$$p = null;
      
      if (($yield !== nil)) {
      } else {
        return $send(self, 'enum_for', ["each_pair"], ($$26 = function(){var self = $$26.$$s == null ? this : $$26.$$s;

        return self.$size()}, $$26.$$s = self, $$26.$$arity = 0, $$26))
      };
      $send(self.$class().$members(), 'each', [], ($$27 = function(name){var self = $$27.$$s == null ? this : $$27.$$s;

      
        
        if (name == null) {
          name = nil;
        };
        return Opal.yield1($yield, [name, self['$[]'](name)]);;}, $$27.$$s = self, $$27.$$arity = 1, $$27));
      return self;
    }, $Struct_each_pair$25.$$arity = 0);
    
    Opal.def(self, '$length', $Struct_length$28 = function $$length() {
      var self = this;

      return self.$class().$members().$length()
    }, $Struct_length$28.$$arity = 0);
    Opal.alias(self, "size", "length");
    
    Opal.def(self, '$to_a', $Struct_to_a$29 = function $$to_a() {
      var $$30, self = this;

      return $send(self.$class().$members(), 'map', [], ($$30 = function(name){var self = $$30.$$s == null ? this : $$30.$$s;

      
        
        if (name == null) {
          name = nil;
        };
        return self['$[]'](name);}, $$30.$$s = self, $$30.$$arity = 1, $$30))
    }, $Struct_to_a$29.$$arity = 0);
    ;
    
    Opal.def(self, '$inspect', $Struct_inspect$31 = function $$inspect() {
      var $a, $$32, self = this, result = nil;

      
      result = "#<struct ";
      if ($truthy(($truthy($a = $$($nesting, 'Struct')['$==='](self)) ? self.$class().$name() : $a))) {
        result = $rb_plus(result, "" + (self.$class()) + " ")};
      result = $rb_plus(result, $send(self.$each_pair(), 'map', [], ($$32 = function(name, value){var self = $$32.$$s == null ? this : $$32.$$s;

      
        
        if (name == null) {
          name = nil;
        };
        
        if (value == null) {
          value = nil;
        };
        return "" + (name) + "=" + (value.$inspect());}, $$32.$$s = self, $$32.$$arity = 2, $$32)).$join(", "));
      result = $rb_plus(result, ">");
      return result;
    }, $Struct_inspect$31.$$arity = 0);
    Opal.alias(self, "to_s", "inspect");
    
    ;
    
    ;
    return (Opal.def(self, '$dig', $Struct_dig$37 = function $$dig(key, $a) {
      var $post_args, keys, self = this, item = nil;

      
      
      $post_args = Opal.slice.call(arguments, 1, arguments.length);
      
      keys = $post_args;;
      item = (function() {if ($truthy(key.$$is_string && self.$$data.hasOwnProperty(key))) {
        return self.$$data[key] || nil;
      } else {
        return nil
      }; return nil; })();
      
      if (item === nil || keys.length === 0) {
        return item;
      }
    ;
      if ($truthy(item['$respond_to?']("dig"))) {
      } else {
        self.$raise($$($nesting, 'TypeError'), "" + (item.$class()) + " does not have #dig method")
      };
      return $send(item, 'dig', Opal.to_a(keys));
    }, $Struct_dig$37.$$arity = -2), nil) && 'dig';
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/main"] = function(Opal) {
  var $to_s$1, $include$2, self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$;

  
  Opal.defs(self, '$to_s', $to_s$1 = function $$to_s() {
    var self = this;

    return "main"
  }, $to_s$1.$$arity = 0);
  return (Opal.defs(self, '$include', $include$2 = function $$include(mod) {
    var self = this;

    return $$($nesting, 'Object').$include(mod)
  }, $include$2.$$arity = 1), nil) && 'include';
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/dir"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy;

  return 
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/file"] = function(Opal) {
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $range = Opal.range, $send = Opal.send;

  return 
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/process"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy;

  
  ;
  ;
  return ;
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/random"] = function(Opal) {
  function $rb_lt(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs < rhs : lhs['$<'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $truthy = Opal.truthy, $send = Opal.send;

  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Random');

    var $nesting = [self].concat($parent_nesting), $Random_initialize$1, $Random_reseed$2, $Random_new_seed$3, $Random_rand$4, $Random_srand$5, $Random_urandom$6, $Random_$eq_eq$8, $Random_bytes$9, $Random_rand$11, $Random_generator$eq$12;

    
    self.$attr_reader("seed", "state");
    
    Opal.def(self, '$initialize', $Random_initialize$1 = function $$initialize(seed) {
      var self = this;

      
      
      if (seed == null) {
        seed = $$($nesting, 'Random').$new_seed();
      };
      seed = $$($nesting, 'Opal')['$coerce_to!'](seed, $$($nesting, 'Integer'), "to_int");
      self.state = seed;
      return self.$reseed(seed);
    }, $Random_initialize$1.$$arity = -1);
    
    Opal.def(self, '$reseed', $Random_reseed$2 = function $$reseed(seed) {
      var self = this;

      
      self.seed = seed;
      return self.$rng = Opal.$$rand.reseed(seed);;
    }, $Random_reseed$2.$$arity = 1);
    Opal.defs(self, '$new_seed', $Random_new_seed$3 = function $$new_seed() {
      var self = this;

      return Opal.$$rand.new_seed();
    }, $Random_new_seed$3.$$arity = 0);
    Opal.defs(self, '$rand', $Random_rand$4 = function $$rand(limit) {
      var self = this;

      
      ;
      return $$($nesting, 'DEFAULT').$rand(limit);
    }, $Random_rand$4.$$arity = -1);
    Opal.defs(self, '$srand', $Random_srand$5 = function $$srand(n) {
      var self = this, previous_seed = nil;

      
      
      if (n == null) {
        n = $$($nesting, 'Random').$new_seed();
      };
      n = $$($nesting, 'Opal')['$coerce_to!'](n, $$($nesting, 'Integer'), "to_int");
      previous_seed = $$($nesting, 'DEFAULT').$seed();
      $$($nesting, 'DEFAULT').$reseed(n);
      return previous_seed;
    }, $Random_srand$5.$$arity = -1);
    ;
    
    Opal.def(self, '$==', $Random_$eq_eq$8 = function(other) {
      var $a, self = this;

      
      if ($truthy($$($nesting, 'Random')['$==='](other))) {
      } else {
        return false
      };
      return (($a = self.$seed()['$=='](other.$seed())) ? self.$state()['$=='](other.$state()) : self.$seed()['$=='](other.$seed()));
    }, $Random_$eq_eq$8.$$arity = 1);
    
    Opal.def(self, '$bytes', $Random_bytes$9 = function $$bytes(length) {
      var $$10, self = this;

      
      length = $$($nesting, 'Opal')['$coerce_to!'](length, $$($nesting, 'Integer'), "to_int");
      return $send($$($nesting, 'Array'), 'new', [length], ($$10 = function(){var self = $$10.$$s == null ? this : $$10.$$s;

      return self.$rand(255).$chr()}, $$10.$$s = self, $$10.$$arity = 0, $$10)).$join().$encode("ASCII-8BIT");
    }, $Random_bytes$9.$$arity = 1);
    
    Opal.def(self, '$rand', $Random_rand$11 = function $$rand(limit) {
      var self = this;

      
      ;
      
      function randomFloat() {
        self.state++;
        return Opal.$$rand.rand(self.$rng);
      }

      function randomInt() {
        return Math.floor(randomFloat() * limit);
      }

      function randomRange() {
        var min = limit.begin,
            max = limit.end;

        if (min === nil || max === nil) {
          return nil;
        }

        var length = max - min;

        if (length < 0) {
          return nil;
        }

        if (length === 0) {
          return min;
        }

        if (max % 1 === 0 && min % 1 === 0 && !limit.excl) {
          length++;
        }

        return self.$rand(length) + min;
      }

      if (limit == null) {
        return randomFloat();
      } else if (limit.$$is_range) {
        return randomRange();
      } else if (limit.$$is_number) {
        if (limit <= 0) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "invalid argument - " + (limit))
        }

        if (limit % 1 === 0) {
          // integer
          return randomInt();
        } else {
          return randomFloat() * limit;
        }
      } else {
        limit = $$($nesting, 'Opal')['$coerce_to!'](limit, $$($nesting, 'Integer'), "to_int");

        if (limit <= 0) {
          self.$raise($$($nesting, 'ArgumentError'), "" + "invalid argument - " + (limit))
        }

        return randomInt();
      }
    ;
    }, $Random_rand$11.$$arity = -1);
    return (Opal.defs(self, '$generator=', $Random_generator$eq$12 = function(generator) {
      var self = this;

      
      Opal.$$rand = generator;
      if ($truthy(self['$const_defined?']("DEFAULT"))) {
        return $$($nesting, 'DEFAULT').$reseed()
      } else {
        return self.$const_set("DEFAULT", self.$new(self.$new_seed()))
      };
    }, $Random_generator$eq$12.$$arity = 1), nil) && 'generator=';
  })($nesting[0], null, $nesting)
};

/*
This is based on an adaptation of Makoto Matsumoto and Takuji Nishimura's code
done by Sean McCullough <banksean@gmail.com> and Dave Heitzman
<daveheitzman@yahoo.com>, subsequently readapted from an updated version of
ruby's random.c (rev c38a183032a7826df1adabd8aa0725c713d53e1c).

The original copyright notice from random.c follows.

  This is based on trimmed version of MT19937.  To get the original version,
  contact <http://www.math.sci.hiroshima-u.ac.jp/~m-mat/MT/emt.html>.

  The original copyright notice follows.

     A C-program for MT19937, with initialization improved 2002/2/10.
     Coded by Takuji Nishimura and Makoto Matsumoto.
     This is a faster version by taking Shawn Cokus's optimization,
     Matthe Bellew's simplification, Isaku Wada's real version.

     Before using, initialize the state by using init_genrand(mt, seed)
     or init_by_array(mt, init_key, key_length).

     Copyright (C) 1997 - 2002, Makoto Matsumoto and Takuji Nishimura,
     All rights reserved.

     Redistribution and use in source and binary forms, with or without
     modification, are permitted provided that the following conditions
     are met:

       1. Redistributions of source code must retain the above copyright
          notice, this list of conditions and the following disclaimer.

       2. Redistributions in binary form must reproduce the above copyright
          notice, this list of conditions and the following disclaimer in the
          documentation and/or other materials provided with the distribution.

       3. The names of its contributors may not be used to endorse or promote
          products derived from this software without specific prior written
          permission.

     THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
     "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
     LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
     A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR
     CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
     EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
     PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
     PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
     LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
     NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
     SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


     Any feedback is very welcome.
     http://www.math.keio.ac.jp/matumoto/emt.html
     email: matumoto@math.keio.ac.jp
*/
var MersenneTwister = (function() {
  /* Period parameters */
  var N = 624;
  var M = 397;
  var MATRIX_A = 0x9908b0df;      /* constant vector a */
  var UMASK = 0x80000000;         /* most significant w-r bits */
  var LMASK = 0x7fffffff;         /* least significant r bits */
  var MIXBITS = function(u,v) { return ( ((u) & UMASK) | ((v) & LMASK) ); };
  var TWIST = function(u,v) { return (MIXBITS((u),(v)) >>> 1) ^ ((v & 0x1) ? MATRIX_A : 0x0); };

  function init(s) {
    var mt = {left: 0, next: N, state: new Array(N)};
    init_genrand(mt, s);
    return mt;
  }

  /* initializes mt[N] with a seed */
  function init_genrand(mt, s) {
    var j, i;
    mt.state[0] = s >>> 0;
    for (j=1; j<N; j++) {
      mt.state[j] = (1812433253 * ((mt.state[j-1] ^ (mt.state[j-1] >> 30) >>> 0)) + j);
      /* See Knuth TAOCP Vol2. 3rd Ed. P.106 for multiplier. */
      /* In the previous versions, MSBs of the seed affect   */
      /* only MSBs of the array state[].                     */
      /* 2002/01/09 modified by Makoto Matsumoto             */
      mt.state[j] &= 0xffffffff;  /* for >32 bit machines */
    }
    mt.left = 1;
    mt.next = N;
  }

  /* generate N words at one time */
  function next_state(mt) {
    var p = 0, _p = mt.state;
    var j;

    mt.left = N;
    mt.next = 0;

    for (j=N-M+1; --j; p++)
      _p[p] = _p[p+(M)] ^ TWIST(_p[p+(0)], _p[p+(1)]);

    for (j=M; --j; p++)
      _p[p] = _p[p+(M-N)] ^ TWIST(_p[p+(0)], _p[p+(1)]);

    _p[p] = _p[p+(M-N)] ^ TWIST(_p[p+(0)], _p[0]);
  }

  /* generates a random number on [0,0xffffffff]-interval */
  function genrand_int32(mt) {
    /* mt must be initialized */
    var y;

    if (--mt.left <= 0) next_state(mt);
    y = mt.state[mt.next++];

    /* Tempering */
    y ^= (y >>> 11);
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= (y >>> 18);

    return y >>> 0;
  }

  function int_pair_to_real_exclusive(a, b) {
    a >>>= 5;
    b >>>= 6;
    return(a*67108864.0+b)*(1.0/9007199254740992.0);
  }

  // generates a random number on [0,1) with 53-bit resolution
  function genrand_real(mt) {
    /* mt must be initialized */
    var a = genrand_int32(mt), b = genrand_int32(mt);
    return int_pair_to_real_exclusive(a, b);
  }

  return { genrand_real: genrand_real, init: init };
})();
Opal.loaded(["corelib/random/MersenneTwister.js"]);
/* Generated by Opal 1.0.0 */
Opal.modules["corelib/random/mersenne_twister"] = function(Opal) {
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $send = Opal.send;

  
  self.$require("corelib/random/MersenneTwister");
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Random');

    var $nesting = [self].concat($parent_nesting), $writer = nil;

    
    var MAX_INT = Number.MAX_SAFE_INTEGER || Math.pow(2, 53) - 1;
    Opal.const_set($nesting[0], 'MERSENNE_TWISTER_GENERATOR', {
    new_seed: function() { return Math.round(Math.random() * MAX_INT); },
    reseed: function(seed) { return MersenneTwister.init(seed); },
    rand: function(mt) { return MersenneTwister.genrand_real(mt); }
  });
    
    $writer = [$$($nesting, 'MERSENNE_TWISTER_GENERATOR')];
    $send(self, 'generator=', Opal.to_a($writer));
    return $writer[$rb_minus($writer["length"], 1)];;
  })($nesting[0], null, $nesting);
};

/* Generated by Opal 1.0.0 */
Opal.modules["corelib/unsupported"] = function(Opal) {
  var $public$35, $private$36, self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$, $klass = Opal.klass, $module = Opal.module;

  
  
  var warnings = {};

 

  function warn(string) {
    if (warnings[string]) {
      return;
    }

    warnings[string] = true;
    self.$warn(string);
  }
;
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'String');

    var $nesting = [self].concat($parent_nesting), $String_$lt$lt$1, $String_capitalize$excl$2, $String_chomp$excl$3, $String_chop$excl$4, $String_downcase$excl$5, $String_gsub$excl$6, $String_lstrip$excl$7, $String_next$excl$8, $String_reverse$excl$9, $String_slice$excl$10, $String_squeeze$excl$11, $String_strip$excl$12, $String_sub$excl$13, $String_succ$excl$14, $String_swapcase$excl$15, $String_tr$excl$16, $String_tr_s$excl$17, $String_upcase$excl$18, $String_prepend$19, $String_$$$eq$20, $String_clear$21, $String_encode$excl$22, $String_unicode_normalize$excl$23;

    
    var ERROR = "String#%s not supported. Mutable String methods are not supported in Opal.";
    
    Opal.def(self, '$<<', $String_$lt$lt$1 = function($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return self.$raise($$($nesting, 'NotImplementedError'), (ERROR)['$%']("<<"));
    }, $String_$lt$lt$1.$$arity = -1);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$reverse!', $String_reverse$excl$9 = function($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return self.$raise($$($nesting, 'NotImplementedError'), (ERROR)['$%']("reverse!"));
    }, $String_reverse$excl$9.$$arity = -1);
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    ;
    
    Opal.def(self, '$[]=', $String_$$$eq$20 = function($a) {
      var $post_args, self = this;

      
      
      $post_args = Opal.slice.call(arguments, 0, arguments.length);
      ;
      return self.$raise($$($nesting, 'NotImplementedError'), (ERROR)['$%']("[]="));
    }, $String_$$$eq$20.$$arity = -1);
    
    ;
    
    ;
    return ( nil) && 'unicode_normalize!';
  })($nesting[0], null, $nesting);
  (function($base, $parent_nesting) {
    var self = $module($base, 'Kernel');

    var $nesting = [self].concat($parent_nesting), $Kernel_freeze$24, $Kernel_frozen$ques$25;

    
    var ERROR = "Object freezing is not supported by Opal";
    
    ;
    
    ;
  })($nesting[0], $nesting);
  (function($base, $parent_nesting) {
    var self = $module($base, 'Kernel');

    var $nesting = [self].concat($parent_nesting), $Kernel_taint$26, $Kernel_untaint$27, $Kernel_tainted$ques$28;

    
    var ERROR = "Object tainting is not supported by Opal";
    
    ;
    
    ;
    
    ;
  })($nesting[0], $nesting);
  (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Module');

    var $nesting = [self].concat($parent_nesting), $Module_public$29, $Module_private_class_method$30, $Module_private_method_defined$ques$31, $Module_private_constant$32;

    
    
    ;
    ;
    ;
    ;
    
    ;
    ;
    
    ;
    
    ;
    ;
    ;
    ;
    return ;
  })($nesting[0], null, $nesting);
  (function($base, $parent_nesting) {
    var self = $module($base, 'Kernel');

    var $nesting = [self].concat($parent_nesting), $Kernel_private_methods$33;

    
    
    ;
    ;
  })($nesting[0], $nesting);
  (function($base, $parent_nesting) {
    var self = $module($base, 'Kernel');

    var $nesting = [self].concat($parent_nesting), $Kernel_eval$34;

    
    
  })($nesting[0], $nesting);
  ;
  return ( nil) && 'private';
};

/* Generated by Opal 1.0.0 */
Opal.modules["opal"] = function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$;

  
  self.$require("opal/base");
  self.$require("opal/mini");
  self.$require("corelib/kernel/format");
  self.$require("corelib/string/encoding");
  self.$require("corelib/math");
  self.$require("corelib/complex");
  self.$require("corelib/rational");
  self.$require("corelib/time");
  self.$require("corelib/struct");
  self.$require("corelib/io");
  self.$require("corelib/main");
  self.$require("corelib/dir");
  self.$require("corelib/file");
  self.$require("corelib/process");
  self.$require("corelib/random");
  self.$require("corelib/random/mersenne_twister.js");
  return self.$require("corelib/unsupported");
};

/* Generated by Opal 1.0.0 */
(function(Opal) {
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.$$$, $$ = Opal.$$;

  
  self.$require("opal");
  return self.$puts("Hello world!");
})(Opal);
