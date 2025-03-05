package co.edu.uniquindio.Biblioteca;

import co.edu.uniquindio.Biblioteca.factory.ModelFactory;
import co.edu.uniquindio.Biblioteca.model.*;

public class Main {

    public static void main(String[] args) {

        ModelFactory modelFactory = ModelFactory.getInstance();
        Biblioteca biblioteca = modelFactory.getBiblioteca();


        Usuario usuario = biblioteca.getUsuarios().get(0);
        Libro libro = biblioteca.getLibros().get(0);
        Bibliotecario bibliotecario = biblioteca.getBibliotecarios().get(0);

        mostrarHistorialPrestamos(usuario);
        devolverLibro(usuario, libro);
        asignarLibroABibliotecario(bibliotecario, libro);
    }

    private static void mostrarHistorialPrestamos(Usuario usuario) {
        System.out.println("\n Historial de préstamos de " + usuario.getNombre() + ":");
        if (usuario.getPrestamosActivos().isEmpty()) {
            System.out.println("No tiene préstamos activos.");
        } else {
            for (Prestamo prestamo : usuario.getPrestamosActivos()) {
                System.out.println("" + prestamo.getLibro().getTitulo() + " (Devuelve el " + prestamo.getFechaDevolucion() + ")");
            }
        }
    }

    private static void devolverLibro(Usuario usuario, Libro libro) {
        System.out.println("\n" + usuario.getNombre() + " está devolviendo el libro: " + libro.getTitulo());

        // Verificar si el usuario tiene préstamos activos de ese libro
        Prestamo prestamoADevolver = null;
        for (Prestamo prestamo : usuario.getPrestamosActivos()) {
            if (prestamo.getLibro().equals(libro)) {
                prestamoADevolver = prestamo;
                break;
            }
        }

        if (prestamoADevolver != null) {
            usuario.getPrestamosActivos().remove(prestamoADevolver);
            prestamoADevolver.devolverLibro();
            System.out.println("l libro '" + libro.getTitulo() + "' ha sido devuelto.");
        } else {
            System.out.println("No se encontró un préstamo activo para este libro.");
        }
    }

    private static void asignarLibroABibliotecario(Bibliotecario bibliotecario, Libro libro) {
        System.out.println("\n Asignando el libro '" + libro.getTitulo() + "' al bibliotecario " + bibliotecario.getNombre());
        bibliotecario.agregarItem(libro);
        System.out.println("Ahora " + bibliotecario.getNombre() + " gestiona el libro '" + libro.getTitulo() + "'.");
    }

}

