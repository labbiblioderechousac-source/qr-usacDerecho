// Achica una foto en el navegador antes de subirla: una foto de celular pesa de 3 a 5 MB y para leer un comprobante bastan unos
// 1600 px de ancho. Queda en WebP (o JPG si el navegador no sabe hacer WebP) con calidad 80 %: de 200 a 300 KB. Así la subida es
// rápida aun con datos móviles y la base de datos no se llena.

export const TIPOS_DE_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const ANCHO_MAXIMO = 1600;
const CALIDAD = 0.8;
const PESO_IDEAL = 350 * 1024; // si pasa de esto, se baja un poco la calidad
const PESO_MAXIMO = 1024 * 1024; // el mismo tope que pone el servidor

function aBlob(lienzo, tipo, calidad) {
  return new Promise((resolver) => lienzo.toBlob(resolver, tipo, calidad));
}

function aDataUrl(blob) {
  return new Promise((resolver, fallar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(lector.result);
    lector.onerror = () => fallar(lector.error);
    lector.readAsDataURL(blob);
  });
}

async function abrirImagen(archivo) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' }); // respeta la foto girada del celular
    } catch {
      // algunos navegadores no la abren así: se intenta con <img>
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const imagen = new Image();
    imagen.src = url;
    await imagen.decode();
    return imagen;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Devuelve { dataUrl, blob, bytes, tipo, ancho, alto } o lanza un Error con un mensaje para la persona.
export async function comprimirFoto(archivo) {
  if (!TIPOS_DE_FOTO.includes(archivo.type)) throw new Error('Solo se aceptan fotos JPG, PNG o WebP.');
  let imagen;
  try {
    imagen = await abrirImagen(archivo);
  } catch {
    throw new Error('No se pudo abrir la imagen. Prueba con otra foto.');
  }
  const anchoOriginal = imagen.width;
  const altoOriginal = imagen.height;
  const escala = Math.min(1, ANCHO_MAXIMO / anchoOriginal);
  const ancho = Math.round(anchoOriginal * escala);
  const alto = Math.round(altoOriginal * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const dibujo = lienzo.getContext('2d');
  dibujo.fillStyle = '#ffffff'; // una imagen con fondo transparente (PNG) queda sobre blanco, no sobre negro
  dibujo.fillRect(0, 0, ancho, alto);
  dibujo.drawImage(imagen, 0, 0, ancho, alto);
  imagen.close?.();

  let blob = await aBlob(lienzo, 'image/webp', CALIDAD);
  if (!blob || blob.type !== 'image/webp') blob = await aBlob(lienzo, 'image/jpeg', CALIDAD);
  for (let calidad = CALIDAD - 0.1; blob && blob.size > PESO_IDEAL && calidad >= 0.5; calidad -= 0.1) {
    blob = await aBlob(lienzo, blob.type, calidad);
  }
  if (!blob) throw new Error('No se pudo preparar la foto. Prueba con otra.');
  if (blob.size > PESO_MAXIMO) throw new Error('La foto sigue pesando más de 1 MB. Toma la foto de nuevo, más de cerca.');
  return { dataUrl: await aDataUrl(blob), blob, bytes: blob.size, tipo: blob.type, ancho, alto };
}

export function pesoLegible(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
