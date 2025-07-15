
import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { PaperAirplaneIcon, ChatBubbleLeftRightIcon, XMarkIcon, PaperClipIcon } from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';

const API_URL = '/api/ai-chat'; // Cambia esto si tu endpoint es diferente

export default function AIChatFab() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<{ user: string; ai: string }[]>([]);
  const [loading, setLoading] = useState(false);
  // ...existing code...

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message && !file) return;
    setLoading(true);
    // ...existing code...
    let aiResponse = '';
    try {
      let response;
      if (file) {
        // Enviar archivo y mensaje como FormData
        const formData = new FormData();
        formData.append('file', file);
        formData.append('message', message);
        response = await fetch(API_URL, {
          method: 'POST',
          body: formData,
        });
      } else {
        // Enviar solo mensaje como JSON
        response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Error de IA');
      aiResponse = data.response || 'Sin respuesta de IA.';
    } catch (err: any) {
      aiResponse = err.message || 'Error de IA';
      // ...existing code...
    }
    setHistory(h => [...h, { user: message || (file ? file.name : ''), ai: aiResponse }]);
    setMessage('');
    setFile(null);
    setLoading(false);
  }

  // Enfocar el input al abrir el chat
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  return (
    <>
      {/* Botón flotante */}
      <button
        className="fixed bottom-6 right-6 z-50 p-4 rounded-full shadow-lg flex items-center transition-colors
          bg-accent text-primary hover:bg-accent/90
          dark:bg-gray-800 dark:text-accent dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700"
        onClick={() => setOpen(true)}
        aria-label="Abrir chat IA"
        style={{ display: open ? 'none' : 'flex' }}
      >
        <ChatBubbleLeftRightIcon className="h-7 w-7" />
      </button>
      {/* Panel lateral de chat */}
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed top-0 right-0 h-full w-full sm:w-[380px] md:w-[400px] max-w-full z-50 bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
            style={{ boxShadow: 'rgba(0,0,0,0.15) -4px 0px 24px' }}
          >
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-800">
              <span className="font-bold text-primary flex items-center gap-2"><ChatBubbleLeftRightIcon className="h-6 w-6" /> Chat IA</span>
              <button onClick={() => setOpen(false)} aria-label="Cerrar chat"><XMarkIcon className="h-6 w-6 text-gray-400 hover:text-primary" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-800">
              {history.length === 0 && <div className="text-gray-400 text-center">¡Hola! Adjunta un archivo o escribe tu consulta.</div>}
              {history.map((h, i) => (
                <div key={i}>
                  <div className="text-right text-sm text-primary font-semibold dark:text-blue-300">Tú: {h.user}</div>
                  <div className="text-left text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg p-3 mt-1 shadow-sm">
                    <ReactMarkdown
                      components={{
                        strong: ({node, ...props}) => <strong className="text-primary dark:text-yellow-300 font-bold" {...props} />,
                        li: ({node, ...props}) => <li className="ml-4 list-disc" {...props} />,
                        a: ({node, ...props}) => <a className="underline text-blue-600 dark:text-blue-300" target="_blank" rel="noopener noreferrer" {...props} />,
                        code: ({node, ...props}) => <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs" {...props} />, 
                        p: ({node, ...props}) => <p className="mb-2" {...props} />,
                      }}
                    >
                      {h.ai}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={handleSend} className="flex items-center gap-2 p-4 border-t bg-white dark:bg-gray-900">
              <button type="button" onClick={() => fileInput.current?.click()} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" aria-label="Adjuntar archivo">
                <PaperClipIcon className="h-6 w-6 text-primary" />
              </button>
              <input
                type="file"
                ref={fileInput}
                className="hidden"
                onChange={e => setFile(e.target.files?.[0] || null)}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
              />
              {file && <span className="text-xs text-gray-600 truncate max-w-[100px]">{file.name}</span>}
              <input
                type="text"
                ref={inputRef}
                className="flex-1 border rounded px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700 focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                placeholder="Escribe tu mensaje..."
                value={message}
                onChange={e => setMessage(e.target.value)}
                disabled={loading}
              />
              <button type="submit" className="bg-primary text-white p-2 rounded-full hover:bg-primary/90 transition" disabled={loading} aria-label="Enviar">
                <PaperAirplaneIcon className="h-5 w-5" />
              </button>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
