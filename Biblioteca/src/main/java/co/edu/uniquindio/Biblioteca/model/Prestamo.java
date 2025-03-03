package co.edu.uniquindio.Biblioteca.model;

import java.util.Date;

public class Prestamo {
    private Date fechaPrestamo;
    private Date fechaDevolucion;
    private Libro libro;
    private Usuario usuario;

    public Prestamo(Libro libro, Usuario usuario, Date date, Date date1) {

    }

    public Prestamo (Date fechaPrestamo, Date fechaDevolucion,
                      Libro libro, Usuario usuario){
        this.fechaPrestamo= fechaPrestamo;
        this.fechaDevolucion= fechaDevolucion;
        this.libro= libro;
        this.usuario= usuario;

    }

    public Date getFechaPrestamo(){
        return fechaPrestamo;

    }

    public void setFechaPrestamo(Date fechaPrestamo){
        this.fechaPrestamo= fechaPrestamo;

    }

    public Date getFechaDevolucion(){
        return fechaDevolucion;

    }

    public void setFechaDevolucion(Date fechaDevolucion){
        this.fechaDevolucion= fechaDevolucion;

    }
     public Libro setLibro(){
        return libro;

     }

     public void getLibro(Libro libro){
        this.libro= libro;

     }

     public Usuario setUsuario(){
        return usuario;

     }

     public void getUsuario(Usuario usuario){
        this.usuario= usuario;

     }
}
