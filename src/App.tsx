import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import Library from './routes/library/Library'
import Reader from './routes/reader/Reader'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/read/:bookId" element={<Reader />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="bottom-right" richColors />
    </>
  )
}
