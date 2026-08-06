// highlight.js with an explicit language set.
//
// The full `highlight.js` bundle registers ~190 languages and costs roughly a
// megabyte. Registering only what a Markdown note realistically contains keeps
// the bundle small while covering the fenced blocks people actually write.

import hljs from 'highlight.js/lib/core';

import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import nginx from 'highlight.js/lib/languages/nginx';
import objectivec from 'highlight.js/lib/languages/objectivec';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const languages = {
    bash,
    c,
    cpp,
    csharp,
    css,
    diff,
    dockerfile,
    go,
    graphql,
    ini,
    java,
    javascript,
    json,
    kotlin,
    less,
    lua,
    makefile,
    markdown,
    nginx,
    objectivec,
    perl,
    php,
    plaintext,
    python,
    r,
    ruby,
    rust,
    scala,
    scss,
    shell,
    sql,
    swift,
    typescript,
    xml,
    yaml
};

Object.entries(languages).forEach(([name, definition]) => {
    hljs.registerLanguage(name, definition);
});

// `xml` covers HTML/SVG/Vue templates; `ini` covers TOML-ish config blocks.
hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' });
hljs.registerAliases(['toml'], { languageName: 'ini' });

export const isSupported = (lang) => Boolean(lang) && Boolean(hljs.getLanguage(lang));

// Returns highlighted HTML, or null when the language is unknown so the caller
// can fall back to plain escaped text rather than guessing.
export const highlight = (code, lang) => {
    if (!isSupported(lang)) {
        return null;
    }

    try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch (error) {
        return null;
    }
};
