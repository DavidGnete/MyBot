/** Una pregunta de un formulario, en nuestro formato común (independiente de la plataforma). */
export type Pregunta = {
  campo: string; // nombre técnico del campo en el formulario, ej. "first_name" o "question_123"
  etiqueta: string; // lo que ve la persona, ej. "LinkedIn Profile"
  tipo: 'texto' | 'parrafo' | 'opcion' | 'multiple' | 'archivo';
  obligatoria: boolean;
  opciones: { etiqueta: string; valor: string }[]; // solo en "opcion" y "multiple"
};

/** Una respuesta lista para llenar el formulario (fase 4b). */
export type Respuesta = {
  campo: string;
  pregunta: string;
  respuesta: string; // en "multiple": etiquetas separadas por " | "
  origen: 'guardada' | 'tuya' | 'automatica'; // automatica = el PDF de tu hoja de vida
};
