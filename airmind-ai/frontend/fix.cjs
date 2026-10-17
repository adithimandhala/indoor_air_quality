const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf8');

// Remove framer-motion imports
code = code.replace(/import \{ motion, AnimatePresence \} from "framer-motion";\n/, '');

// Replace motion.div -> div, motion.button -> button, motion.circle -> circle
code = code.replace(/<motion\.([a-z]+)/g, '<$1');
code = code.replace(/<\/motion\.([a-z]+)>/g, '</$1>');

// Remove AnimatePresence
code = code.replace(/<AnimatePresence>/g, '<div className="animate-presence">');
code = code.replace(/<\/AnimatePresence>/g, '</div>');

// Remove framer-motion props
code = code.replace(/initial=\{[^}]+\}/g, '');
code = code.replace(/animate=\{[^}]+\}/g, '');
code = code.replace(/transition=\{[^}]+\}/g, '');
code = code.replace(/whileHover=\{[^}]+\}/g, '');
code = code.replace(/whileTap=\{[^}]+\}/g, '');
code = code.replace(/exit=\{[^}]+\}/g, '');

fs.writeFileSync('src/App.jsx', code);
console.log('Framer motion removed');
