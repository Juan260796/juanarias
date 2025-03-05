package co.edu.uniquindio.Biblioteca.services;

import co.edu.uniquindio.Biblioteca.model.Bibliotecario;
import co.edu.uniquindio.Biblioteca.model.Libro;
import co.edu.uniquindio.Biblioteca.model.Usuario;

public interface IModelServices {
    String mostrarHistorialPrestamos(Usuario usuario);
    String devolverLibro(Usuario usuario, Libro libro);
    String asignarLibroABibliotecario(Bibliotecario bibliotecario, Libro libro);
}
