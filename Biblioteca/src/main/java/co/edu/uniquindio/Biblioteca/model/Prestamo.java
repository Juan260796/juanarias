package co.edu.uniquindio.Biblioteca.model;

import java.time.LocalDate;

public class Prestamo {
    private LocalDate fechaPrestamo;
    private LocalDate fechaDevolucion;
    private Libro libro;
    private Usuario usuario;

    public Prestamo() {

    }

    public Prestamo (Libro libro, Usuario usuario, LocalDate fechaDevolucion){
        this.libro= libro;
        this.usuario= usuario;
        this.fechaPrestamo= LocalDate.now();
        this.fechaDevolucion= fechaDevolucion;
        libro.prestar();
    }


    public LocalDate getFechaPrestamo(){
        return fechaPrestamo;

    }

    public void setFechaPrestamo(LocalDate fechaPrestamo){
        this.fechaPrestamo= fechaPrestamo;

    }

    public LocalDate getFechaDevolucion(){
        return fechaDevolucion;

    }

    public void setFechaDevolucion(LocalDate fechaDevolucion){
        this.fechaDevolucion= fechaDevolucion;

    }
     public Libro getLibro(){
        return libro;

     }

     public void setLibro(Libro libro){
        this.libro= libro;

     }

     public Usuario getUsuario(){
        return usuario;

     }

     public void setUsuario(Usuario usuario){
        this.usuario= usuario;
    }

        public void devolverLibro() {
        libro.devolver();

     }

}


