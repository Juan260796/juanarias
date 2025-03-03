package co.edu.uniquindio.Biblioteca.model;

import com.sun.source.doctree.EscapeTree;

public class Libro {

    public enum EstadoLibro{

        DISPONIBLE,
        PRESTADO
    }
    private String autor;
    private String titulo;
    private String isbn;
    private EstadoLibro estado;

    public Libro(){

    }
        public Libro(String autor,String titulo,String isbn, String estado){

        Libro libro= new Libro();
        this.autor= autor;
        this.titulo= titulo;
        this.isbn= isbn;
        this.estado= EstadoLibro.DISPONIBLE;
    }

    public String getAutor(){

        return autor;
    }

    public void setAutor(String autor){
        this.autor= autor;

    }

    public String getTitulo(){
        return titulo;

    }

    public void setTitulo(String titulo){
        this.titulo= titulo;

    }

    public String getIsbn(){
        return isbn;

    }

    public void setIsbn(String isbn){
        this.isbn= isbn;

    }

    public EstadoLibro getEstado(){
        return estado;

    }

    public void prestar(){
        if(estado==EstadoLibro.DISPONIBLE){
            estado = EstadoLibro.PRESTADO;
            System.out.println("El libro " +titulo +"se encuentra prestado");
        }else{
            System.out.println("No se puede prestar, el libro se encuentra " +estado);
        }
    }

    public void devolver() {
        if (estado == EstadoLibro.PRESTADO) {
            estado = EstadoLibro.DISPONIBLE;
            System.out.println("El libro " + titulo + " ha sio devuelto.");
        } else {
            System.out.println("El libro " + titulo + "no está prestado.");
        }
    }


}
