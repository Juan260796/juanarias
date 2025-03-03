package co.edu.uniquindio.Biblioteca.model;

import co.edu.uniquindio.Biblioteca.model.Libro.EstadoLibro;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

public class gestorPrestamos {
    private List<Prestamo> prestamos = new ArrayList<>();

    public void agregarPrestamo(Libro libro, Usuario usuario) {
        if ( Libro.EstadoLibro()) {
            Prestamo prestamo = new Prestamo(libro, usuario, new Date(), new Date());
            prestamos.add(prestamo);
            System.out.println("Préstamo registrado: " + usuario.getNombre() + " ha tomado " + libro);
        } else {
            System.out.println("Error: El libro " + libro + " ya está prestado.");
        }
    }

    public void devolverLibro(Libro libro) {
        prestamos.removeIf(prestamo.getLibro().equals(libro));
        libro.devolver();
        System.out.println("📚 El libro " + libro + " ha sido devuelto.");
    }

    public List<Prestamo> getPrestamosActivos() {
        return prestamos;
    }

    }
