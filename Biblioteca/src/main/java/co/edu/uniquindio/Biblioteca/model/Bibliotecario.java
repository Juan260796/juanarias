package co.edu.uniquindio.Biblioteca.model;
import co.edu.uniquindio.Biblioteca.services.GestionInventario;
import co.edu.uniquindio.Biblioteca.services.GestionItem;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

public class Bibliotecario extends Empleado implements GestionItem {
    private List<ItemBiblioteca> itemsGestionados;

    public Bibliotecario(String nombre, String idEmpleado) {
        super(nombre, idEmpleado);
        this.itemsGestionados = new ArrayList<>();
    }

    public void agregarItem(ItemBiblioteca item) {
        itemsGestionados.add(item);
    }

    public void gestionarPrestamo(Usuario usuario, Libro libro, LocalDate fechaDevolucion) {
        if (libro.getEstado() == Libro.EstadoLibro.DISPONIBLE) {
            Prestamo prestamo = new Prestamo(libro, usuario, fechaDevolucion);
            usuario.agregarPrestamo(prestamo);
            System.out.println("Préstamo completado: " + usuario.getNombre() + " tomó " + libro.getTitulo());
        } else {
            System.out.println("El libro está prestado.");
        }
    }

    @Override
    public void gestionarItem() {
        System.out.println(getNombre() + " está gestionando el inventario.");
    }


}
